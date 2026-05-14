import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Provider, ProviderInfo, ChatContent, ChatTurnCallbacks, SendOptions } from './Provider'
import { AgentStateManager } from '../AgentStateManager'
import { hasBinary, spawnPath } from '../platform'

/**
 * OpenAI Codex CLI provider — github.com/openai/codex (Rust, 82k★).
 *
 * Install: `npm i -g @openai/codex` or `brew install --cask codex`.
 *
 * Non-interactive surface:
 *   codex exec [prompt] --json [--model X] [--full-auto]
 *     [--image FILE] [--output-last-message FILE]
 *
 * `--json` emits one JSON event per line. Event types we care about:
 *   { type: "thread.started", thread_id }                            → onSessionId
 *   { type: "item.started"|"item.updated"|"item.completed",
 *       item: { id, type, ...payload } }
 *   { type: "turn.completed", usage }                                → onDone + stop
 *   { type: "turn.failed", error: { message } }                      → onError
 *   { type: "error", message }                                       → onError
 *
 * Item.type values:
 *   - agent_message { text }     — assistant chunk (full text per update)
 *   - reasoning { text }
 *   - command_execution { command, status }
 *   - file_change { changes, status }
 *   - mcp_tool_call / collab_tool_call / web_search / todo_list / error
 */

/**
 * Read codex's model from ~/.codex/config.toml. We don't ship a full
 * TOML parser — pet only needs the top-level `model = "..."` line, and
 * optionally any `[model_providers.X]` blocks that define alternative
 * models. A regex sweep is fine for the well-formed configs codex
 * itself produces.
 */
function readCodexModels(): string[] {
  const cfg = path.join(os.homedir(), '.codex', 'config.toml')
  if (!fs.existsSync(cfg)) return []
  try {
    const text = fs.readFileSync(cfg, 'utf-8')
    const models = new Set<string>()
    // Top-level `model = "X"` (must come before any [section])
    const topModelMatch = text.split(/^\[/m)[0].match(/^\s*model\s*=\s*"([^"]+)"/m)
    if (topModelMatch) models.add(topModelMatch[1])
    // Any [model_providers.<id>.models.<m>] blocks would surface
    // additional names — uncommon in codex configs but cheap to scan.
    for (const m of text.matchAll(/\[model_providers\.[^.\]]+\.models\.([^\]]+)\]/g)) {
      models.add(m[1])
    }
    return Array.from(models)
  } catch {
    return []
  }
}

export class CodexProvider implements Provider {
  readonly info: ProviderInfo
  private agentState: AgentStateManager | null
  private codexBin: string

  constructor(codexBin = 'codex', agentState: AgentStateManager | null = null) {
    this.codexBin = codexBin
    this.agentState = agentState
    const configDir = path.join(os.homedir(), '.codex')
    // Codex models — sane defaults for users without a config.toml yet.
    // First-time install will let user pick any model the openai
    // account has access to; we list the popular ones up front.
    const defaultModels = ['gpt-5.5', 'gpt-5', 'o3', 'o3-mini', 'gpt-4o']
    const fromConfig = readCodexModels()
    // Configured models win priority (first → defaultModel)
    const merged: string[] = [...fromConfig]
    for (const m of defaultModels) if (!merged.includes(m)) merged.push(m)
    this.info = {
      id: 'codex',
      displayName: 'Codex',
      configDir,
      skillsDir: path.join(configDir, 'skills'),
      models: merged,
      defaultModel: merged[0],
      available: hasBinary(codexBin)
    }
  }

  send(
    content: ChatContent[],
    options: SendOptions,
    callbacks: ChatTurnCallbacks
  ): Promise<string> {
    return new Promise((resolve) => {
      // Pull text + write image attachments to temp files so we can
      // pass them via -i. codex doesn't accept inline base64 images.
      const textParts = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text as string)
      const prompt = textParts.join('\n')

      const imageFiles: string[] = []
      for (const c of content) {
        if (c.type !== 'image' || !c.source) continue
        const tmp = path.join(
          os.tmpdir(),
          `claude-pets-codex-img-${Date.now()}-${imageFiles.length}.png`
        )
        try {
          fs.writeFileSync(tmp, Buffer.from(c.source.data, 'base64'))
          imageFiles.push(tmp)
        } catch {
          /* ignore */
        }
      }

      // Verified on codex-cli 0.130: `codex exec --json resume <id>
      // "prompt"` works fine — the `--json` flag is accepted on both
      // top-level exec and resume subcommand. Use resume to keep
      // agent-side conversation context across turns.
      const args: string[] = ['exec', '--json', '--full-auto']
      if (options.model) args.push('--model', options.model)
      for (const f of imageFiles) args.push('-i', f)
      if (options.sessionId) {
        args.push('resume', options.sessionId, prompt)
      } else {
        args.push(prompt)
      }

      console.log(
        `[CodexProvider] spawn ${this.codexBin} ${args
          .map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a))
          .join(' ')}`
      )
      const proc: ChildProcess = spawn(this.codexBin, args, {
        cwd: options.cwd ?? os.homedir(),
        env: { ...process.env, PATH: spawnPath() },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.agentState?.handleHook('codex', 'user')

      let stdoutBuf = ''
      let stderrBuf = ''
      let lastAssistantText = ''
      let finalText = ''
      let finished = false
      let errorMsg: string | null = null

      const finish = (code: number | null): void => {
        for (const f of imageFiles) {
          try {
            fs.unlinkSync(f)
          } catch {
            /* ignore */
          }
        }
        if (finished) return
        finished = true
        this.agentState?.handleHook('codex', 'stop')
        if (errorMsg) {
          callbacks.onError?.(errorMsg)
          resolve('')
          return
        }
        if (finalText) {
          callbacks.onDone?.(finalText)
          resolve(finalText)
          return
        }
        if (code !== 0 && code !== null) {
          const msg = stderrBuf.trim() || `codex exited with code ${code}`
          callbacks.onError?.(msg)
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
          const line = stdoutBuf.slice(0, nl).trim()
          stdoutBuf = stdoutBuf.slice(nl + 1)
          if (!line) continue
          this.handleStdoutLine(line, lastAssistantText, callbacks, (newAssistantText, fr, em) => {
            if (newAssistantText !== null) lastAssistantText = newAssistantText
            if (fr !== null) finalText = fr
            if (em !== null) errorMsg = em
          })
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8')
      })

      proc.on('error', (err) => {
        console.error('[CodexProvider] spawn error:', err.message)
        callbacks.onError?.(err.message)
        this.agentState?.handleHook('codex', 'stop')
        resolve('')
      })

      proc.on('exit', (code) => {
        console.log(
          `[CodexProvider] exit code=${code} textLen=${lastAssistantText.length} stderr=${stderrBuf.trim().slice(0, 200)}`
        )
        finish(code)
      })
    })
  }

  private handleStdoutLine(
    line: string,
    lastAssistantText: string,
    callbacks: ChatTurnCallbacks,
    update: (
      newAssistantText: string | null,
      finalResult: string | null,
      errorMsg: string | null
    ) => void
  ): void {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (typeof event !== 'object' || event === null) return
    const e = event as {
      type?: string
      thread_id?: string
      message?: string
      error?: { message?: string }
      item?: { id?: string; type?: string; text?: string; command?: string }
    }

    if (e.type === 'thread.started' && typeof e.thread_id === 'string') {
      callbacks.onSessionId?.(e.thread_id)
      return
    }

    if (
      (e.type === 'item.started' ||
        e.type === 'item.updated' ||
        e.type === 'item.completed') &&
      e.item
    ) {
      const it = e.item
      if (it.type === 'agent_message' && typeof it.text === 'string') {
        // codex emits the FULL accumulated text per update — same
        // shape as Claude Code's stream-json. Emit only the delta.
        const text = it.text
        if (text.length > lastAssistantText.length && text.startsWith(lastAssistantText)) {
          callbacks.onChunk?.(text.slice(lastAssistantText.length))
        } else if (text !== lastAssistantText) {
          callbacks.onChunk?.(text)
        }
        update(text, null, null)
      }
      if (it.type === 'command_execution' && typeof it.command === 'string') {
        const first = it.command.split(/\s+/)[0] || it.command
        this.agentState?.handleHook('codex', 'pre', {
          toolName: 'Bash',
          toolInput: { command: it.command, head: first }
        })
      }
      if (it.type === 'file_change') {
        this.agentState?.handleHook('codex', 'pre', {
          toolName: 'Edit',
          toolInput: null
        })
      }
      if (it.type === 'web_search') {
        this.agentState?.handleHook('codex', 'pre', {
          toolName: 'WebSearch',
          toolInput: null
        })
      }
      return
    }

    if (e.type === 'turn.completed') {
      // Use the accumulated text we've been tracking. update() already
      // mirrored the last agent_message text into newAssistantText.
      update(null, null, null)
      return
    }

    if (e.type === 'turn.failed') {
      const msg = e.error?.message ?? 'codex turn failed'
      update(null, null, msg)
      return
    }

    if (e.type === 'error') {
      const msg = e.message ?? 'codex error'
      update(null, null, msg)
      return
    }
  }
}
