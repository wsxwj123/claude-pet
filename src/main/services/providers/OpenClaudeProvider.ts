import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Provider, ProviderInfo, ChatContent, ChatTurnCallbacks, SendOptions } from './Provider'
import { AgentStateManager } from '../AgentStateManager'
import { hasBinary, spawnPath, resolveSpawn } from '../platform'

// openclaude is a Claude Code fork at https://github.com/Gitlawb/openclaude
// installed via `npm install -g @gitlawb/openclaude`. It mirrors claude's
// CLI surface (`-p`, `--input-format stream-json`, `--output-format
// stream-json`, `--model`, `--resume`, `--permission-mode`, etc.) so we
// can reuse the ClaudeCliProvider event-parsing logic verbatim.

/**
 * Read agent model names from ~/.openclaude.json's `agentModels` map.
 * Each key is a model id usable as `--model <id>`. Returns [] if the file
 * doesn't exist or has no agentModels.
 */
function readOpenClaudeModels(configDir: string): string[] {
  try {
    const cfgPath = path.join(configDir, '.openclaude.json')
    if (!fs.existsSync(cfgPath)) return []
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    const out: string[] = []
    if (cfg.agentModels && typeof cfg.agentModels === 'object') {
      for (const k of Object.keys(cfg.agentModels)) out.push(k)
    }
    if (typeof cfg.model === 'string' && !out.includes(cfg.model)) out.push(cfg.model)
    return out
  } catch {
    return []
  }
}

// (binaryExists removed — use hasBinary() from ../platform)

export class OpenClaudeProvider implements Provider {
  readonly info: ProviderInfo
  private agentState: AgentStateManager | null
  private openclaudeBin: string

  constructor(openclaudeBin = 'openclaude', agentState: AgentStateManager | null = null) {
    this.openclaudeBin = openclaudeBin
    this.agentState = agentState
    const configDir = os.homedir()
    const models = readOpenClaudeModels(configDir)
    this.info = {
      id: 'openclaude',
      displayName: 'OpenClaude',
      configDir,
      // openclaude reuses ~/.claude/skills (it's a Claude Code fork) but
      // points users to ~/.openclaude.json for provider config. We expose
      // ~/.openclaude as the conceptual config dir.
      skillsDir: path.join(os.homedir(), '.claude', 'skills'),
      models,
      defaultModel: models[0],
      available: hasBinary(openclaudeBin)
    }
  }

  send(
    content: ChatContent[],
    options: SendOptions,
    callbacks: ChatTurnCallbacks
  ): Promise<string> {
    return new Promise((resolve) => {
      const args = [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose'
      ]
      if (options.sessionId) args.push('--resume', options.sessionId)
      if (options.model) args.push('--model', options.model)

      console.log(
        `[OpenClaudeProvider] spawn ${this.openclaudeBin} ${args
          .map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a))
          .join(' ')}`
      )
      const { command, shell } = resolveSpawn(this.openclaudeBin)
      const proc: ChildProcess = spawn(command, args, {
        cwd: options.cwd ?? os.homedir(),
        env: { ...process.env, PATH: spawnPath() },
        shell
      })

      let stdoutBuf = ''
      let stderrBuf = ''
      let lastAssistantText = ''
      let finalResult: string | null = null
      let errorMsg: string | null = null
      let pushedUserHook = false

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8')
        let nl: number
        while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, nl)
          stdoutBuf = stdoutBuf.slice(nl + 1)
          if (!line.trim()) continue
          this.handleStdoutLine(
            line,
            lastAssistantText,
            callbacks,
            (newAssistantText, fr, em) => {
              if (newAssistantText !== null) lastAssistantText = newAssistantText
              if (fr !== null) finalResult = fr
              if (em !== null) errorMsg = em
            },
            () => {
              if (!pushedUserHook) {
                pushedUserHook = true
                this.agentState?.handleHook('openclaude', 'user')
              }
            }
          )
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8')
      })

      proc.on('error', (err) => {
        console.error('[OpenClaudeProvider] spawn error:', err.message)
        callbacks.onError?.(err.message)
        this.agentState?.handleHook('openclaude', 'stop')
        resolve('')
      })

      proc.on('exit', (code) => {
        console.log(
          `[OpenClaudeProvider] exit code=${code} resultLen=${finalResult?.length ?? 0} stderr=${stderrBuf.trim().slice(0, 200)}`
        )
        // Always release agent state on exit so the bubble doesn't get
        // stuck mid-status.
        this.agentState?.handleHook('openclaude', 'stop')
        if (errorMsg) {
          callbacks.onError?.(errorMsg)
          resolve('')
          return
        }
        if (finalResult !== null) {
          callbacks.onDone?.(finalResult)
          resolve(finalResult)
          return
        }
        if (code !== 0) {
          const msg = stderrBuf.trim() || `openclaude exited with code ${code}`
          callbacks.onError?.(msg)
          resolve('')
          return
        }
        callbacks.onDone?.(lastAssistantText)
        resolve(lastAssistantText)
      })

      const userTurn = { type: 'user', message: { role: 'user', content } }
      proc.stdin?.write(JSON.stringify(userTurn) + '\n')
      proc.stdin?.end()
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
    ) => void,
    notifyUserStart: () => void
  ): void {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (typeof event !== 'object' || event === null) return
    const e = event as Record<string, unknown>

    if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') {
      callbacks.onSessionId?.(e.session_id)
      notifyUserStart()
      return
    }

    if (e.type === 'assistant') {
      const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined
      const blocks = msg?.content ?? []
      // Tool use → push 'pre' so pet shows "调用 X"
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          const tu = b as unknown as { name?: string; input?: Record<string, unknown> }
          if (tu.name) {
            this.agentState?.handleHook('openclaude', 'pre', {
              toolName: tu.name,
              toolInput: tu.input ?? null
            })
          }
        }
      }
      const text = blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('')
      if (text) {
        if (text.length > lastAssistantText.length && text.startsWith(lastAssistantText)) {
          callbacks.onChunk?.(text.slice(lastAssistantText.length))
        } else {
          callbacks.onChunk?.(text)
        }
        update(text, null, null)
      }
      return
    }

    if (e.type === 'result') {
      const isError = e.is_error === true
      const text = typeof e.result === 'string' ? e.result : ''
      if (isError) {
        update(null, null, text || 'openclaude returned an error')
      } else {
        update(null, text, null)
      }
      return
    }
  }
}
