import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Provider, ProviderInfo, ChatContent, ChatTurnCallbacks, SendOptions } from './Provider'
import { AgentStateManager } from '../AgentStateManager'
import { hasBinary, spawnPath, resolveBinary } from '../platform'

/**
 * opencode provider — `opencode run "<prompt>" --format json [-c|--session id] [-m provider/model]`
 *
 * Output is a sequence of one-line JSON events. We care about:
 *   - {type:"text",part:{text,messageID,sessionID}} → assistant chunk
 *     (FULL accumulated text per event, like Claude Code — emit delta)
 *   - {type:"step_finish",part:{reason:"stop"}} → turn complete
 *   - sessionID is the same across all events in a turn
 *
 * Skill / file-write / shell-exec capabilities are inherited from the
 * user's existing ~/.config/opencode/* setup; opencode loads them
 * automatically when it sees the prompt.
 */
export class OpenCodeProvider implements Provider {
  readonly info: ProviderInfo
  private agentState: AgentStateManager | null

  constructor(opencodeBin = 'opencode', agentState: AgentStateManager | null = null) {
    this.agentState = agentState
    const configDir = process.env.OPENCODE_CONFIG_DIR
      ?? (process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
        : path.join(os.homedir(), '.config', 'opencode'))
    const skillsDir = path.join(configDir, 'skills')
    const models = this.readModelsFromConfig(configDir)
    this.info = {
      id: 'opencode',
      displayName: 'opencode',
      configDir,
      skillsDir,
      models,
      defaultModel: models[0],
      available: hasBinary(opencodeBin)
    }
    this.opencodeBin = opencodeBin
  }

  private opencodeBin: string

  private readModelsFromConfig(configDir: string): string[] {
    try {
      const cfgPath = path.join(configDir, 'opencode.json')
      if (!fs.existsSync(cfgPath)) return []
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      const out: string[] = []
      // Default model from top-level `model`
      if (typeof cfg.model === 'string') out.push(cfg.model)
      // Plus everything declared under `provider.<pid>.models.<mid>`
      const providers = cfg.provider ?? {}
      for (const [pid, pdef] of Object.entries(providers as Record<string, unknown>)) {
        const models = (pdef as { models?: Record<string, unknown> }).models ?? {}
        for (const mid of Object.keys(models)) {
          const full = `${pid}/${mid}`
          if (!out.includes(full)) out.push(full)
        }
      }
      return out
    } catch {
      return []
    }
  }

  send(
    content: ChatContent[],
    options: SendOptions,
    callbacks: ChatTurnCallbacks
  ): Promise<string> {
    return new Promise((resolve) => {
      // opencode `run` takes the prompt as positional arg. For multi-content
      // turns (text + images) we concatenate the text parts and attach images
      // via -f / --file. opencode doesn't currently accept base64 inline.
      const textParts = content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string)
      const prompt = textParts.join('\n')

      const imageFiles: string[] = []
      for (const c of content) {
        if (c.type !== 'image' || !c.source) continue
        const tmp = path.join(
          os.tmpdir(),
          `claude-pets-img-${Date.now()}-${imageFiles.length}.png`
        )
        try {
          fs.writeFileSync(tmp, Buffer.from(c.source.data, 'base64'))
          imageFiles.push(tmp)
        } catch {
          // ignore one bad image
        }
      }

      // `--pure` disables all opencode plugins. We always pass it because
      // popular plugins (oh-my-opencode-slim's preset, in particular)
      // hardcode `agent.model`, which silently overrides the user's
      // `--model` flag — making pet's model picker useless. Pet keeps
      // its own ChatStore + streaming, so it doesn't need plugin-side
      // memory/skill injection.
      // `--file` in opencode is declared as a variadic array flag —
      // without an explicit `--` separator yargs swallows everything
      // after the last --file (including our positional `prompt`) into
      // the file list. Result: opencode reports `File not found: 看看
      // 这个是什么图` because it tried to open the prompt as a file.
      // Two safe encodings:
      //   1. Put prompt FIRST positional, then --file flags last
      //   2. Use `--` to terminate options before prompt
      // We do (2) — clearer for log readability.
      const args = [
        'run',
        '--format',
        'json',
        '--pure',
        ...(options.sessionId ? ['--session', options.sessionId] : []),
        ...(options.model ? ['--model', options.model] : []),
        ...imageFiles.flatMap((f) => ['--file', f]),
        ...(imageFiles.length > 0 ? ['--'] : []),
        prompt
      ]

      console.log(
        `[OpenCodeProvider] spawn ${this.opencodeBin} ${args
          .map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a))
          .join(' ')}`
      )
      // NOTE: opencode 1.14.28 has a known bug where `--model` (and
      // OPENCODE_CONFIG_CONTENT, and `--agent <name>` + `--model`) all
      // get silently ignored — verified empirically. See sst/opencode
      // issue #26901. We still pass --model so pet picks up any future
      // fix automatically; today the model is effectively dictated by
      // whatever the user's plugins / on-disk opencode.json define.
      // Windows: child_process.spawn() doesn't auto-resolve `opencode`
      // → `opencode.exe`/`opencode.cmd`, so spawn fails with ENOENT
      // even when the binary is on PATH. Always pass the absolute path.
      // For .cmd/.bat shims (npm-global on Windows), shell:true is also
      // required since Node won't direct-exec them.
      const absBin = resolveBinary(this.opencodeBin) ?? this.opencodeBin
      const needsShell = /\.(cmd|bat|ps1)$/i.test(absBin)
      const proc: ChildProcess = spawn(absBin, args, {
        cwd: options.cwd ?? os.homedir(),
        env: { ...process.env, PATH: spawnPath() },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: needsShell
      })

      let stdoutBuf = ''
      let stderrBuf = ''
      let lastAssistantText = ''
      let finalText = ''
      let finished = false

      const finish = (code: number | null): void => {
        // Clean up temp images
        for (const f of imageFiles) {
          try { fs.unlinkSync(f) } catch { /* ignore */ }
        }
        if (finished) return
        finished = true
        // Process exited — always release the agent state. Without this
        // the pet's status bubble stays stuck on whatever the last
        // tool_use set it to (e.g. "读取 foo.ts"), because we'd otherwise
        // only push 'stop' on step_finish reason=stop, which never
        // arrives if the LLM gives up mid-tool-call.
        this.agentState?.handleHook('opencode', 'stop')
        if (finalText) {
          callbacks.onDone?.(finalText)
          resolve(finalText)
          return
        }
        if (code !== 0 && code !== null) {
          const msg = stderrBuf.trim() || `opencode exited with code ${code}`
          callbacks.onError?.(msg)
          resolve('')
          return
        }
        // Exit 0 with empty text usually means a tool error blocked the
        // LLM (e.g. `--pure` rejecting /tmp file reads). Surface it so
        // the user sees something more useful than a blank reply.
        if (!lastAssistantText && stderrBuf.trim()) {
          callbacks.onError?.(stderrBuf.trim().slice(0, 500))
          resolve('')
          return
        }
        callbacks.onDone?.(lastAssistantText)
        resolve(lastAssistantText)
      }

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8')
        let nl: number
        while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, nl)
          stdoutBuf = stdoutBuf.slice(nl + 1)
          if (!line.trim()) continue
          this.handleStdoutLine(line, lastAssistantText, callbacks, (newText, isFinal) => {
            if (newText !== null) {
              lastAssistantText = newText
              if (isFinal) finalText = newText
            }
          })
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8')
      })

      proc.on('error', (err) => {
        console.error('[OpenCodeProvider] spawn error:', err.message)
        callbacks.onError?.(err.message)
        if (!finished) {
          finished = true
          resolve('')
        }
      })

      proc.on('exit', (code) => {
        console.log(
          `[OpenCodeProvider] exit code=${code} textLen=${lastAssistantText.length} stderr=${stderrBuf.trim().slice(0, 200)}`
        )
        finish(code)
      })
    })
  }

  private handleStdoutLine(
    line: string,
    lastAssistantText: string,
    callbacks: ChatTurnCallbacks,
    update: (newText: string | null, isFinal: boolean) => void
  ): void {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (typeof event !== 'object' || event === null) return
    const e = event as { type?: string; sessionID?: string; part?: Record<string, unknown> }

    if (e.type === 'step_start' && typeof e.sessionID === 'string') {
      callbacks.onSessionId?.(e.sessionID)
      // First step_start = LLM is thinking. Push 'user' kind so the pet
      // shows the "got it" bounce then transitions to the "review" /
      // thinking state via AgentStateManager's POST_JUMPING_STATE flow.
      this.agentState?.handleHook('opencode', 'user')
      return
    }

    if (e.type === 'tool_use' && e.part) {
      // opencode emits tool_use only after the tool has run (state.status
      // === 'completed' typically), so we briefly flash 'pre' with the
      // tool context, then immediately return to 'review' thinking.
      const tool = typeof e.part.tool === 'string' ? (e.part.tool as string) : null
      const state = (e.part.state as { input?: Record<string, unknown> } | undefined) ?? undefined
      const input = (state?.input as Record<string, unknown> | undefined) ?? null
      if (tool) {
        this.agentState?.handleHook('opencode', 'pre', { toolName: tool, toolInput: input })
        // Don't immediately flip back — handleHook for 'pre' sets state
        // to 'running' and stays there. The next step_start (LLM
        // resuming) will move us back to 'review'.
      }
      return
    }

    if (e.type === 'text' && e.part) {
      const text = typeof e.part.text === 'string' ? e.part.text : ''
      if (!text) return
      // Emit delta
      if (text.length > lastAssistantText.length && text.startsWith(lastAssistantText)) {
        callbacks.onChunk?.(text.slice(lastAssistantText.length))
      } else {
        callbacks.onChunk?.(text)
      }
      update(text, false)
      return
    }

    if (e.type === 'step_finish' && e.part) {
      const reason = (e.part.reason as string | undefined) ?? ''
      if (reason === 'stop' || reason === 'end_turn') {
        update(lastAssistantText, true)
        // Turn complete — show the brief "completion" wave then idle.
        this.agentState?.handleHook('opencode', 'stop')
      }
      return
    }
  }
}
