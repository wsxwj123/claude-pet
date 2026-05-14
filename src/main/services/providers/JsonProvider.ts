import { spawn, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import { Provider, ProviderInfo, ChatContent, ChatTurnCallbacks, SendOptions } from './Provider'
import { AgentStateManager } from '../AgentStateManager'
import { hasBinary, spawnPath } from '../platform'

/**
 * JSON-defined custom provider. Schema lives at
 * ~/.claude-pets/providers/*.json. Example:
 *
 *   {
 *     "id": "aider",
 *     "displayName": "Aider",
 *     "binary": "aider",
 *     "args": ["--message", "{prompt}", "--no-pretty", "--stream"],
 *     "stdinPrompt": false,
 *     "configDir": "~/.aider.conf.d",
 *     "env": { "OPENAI_API_BASE": "https://api.deepseek.com/v1" },
 *     "models": ["deepseek-chat"],
 *     "defaultModel": "deepseek-chat",
 *     "events": {
 *       "kind": "text-stream"
 *     }
 *   }
 *
 * Two event-parse modes:
 *   - kind: "text-stream" (default) — stdout raw text is forwarded as-is
 *     to onChunk; process exit triggers onDone with the full accumulated
 *     text. Simplest, works with most CLIs that just print to stdout.
 *   - kind: "json-events" — each stdout line is JSON. textPath / donePath
 *     are dotted accessors into each event to extract chunks / completion.
 */

export interface JsonProviderSpec {
  id: string
  displayName: string
  binary: string
  args?: string[]
  /** Pipe the prompt to stdin instead of substituting {prompt} in args. */
  stdinPrompt?: boolean
  /** ~ is expanded to homedir. */
  configDir?: string
  skillsDir?: string
  env?: Record<string, string>
  models?: string[]
  defaultModel?: string
  events?: {
    kind?: 'text-stream' | 'json-events'
    /** For json-events: dotted path to the assistant text in each event (e.g. "part.text"). */
    textPath?: string
    /** For json-events: dotted path that, if truthy, marks the turn as complete. */
    donePath?: string
  }
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

function getByPath(obj: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split('.')
  let cur: unknown = obj
  for (const k of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

export class JsonProvider implements Provider {
  readonly info: ProviderInfo
  private spec: JsonProviderSpec
  private agentState: AgentStateManager | null

  constructor(spec: JsonProviderSpec, agentState: AgentStateManager | null = null) {
    this.spec = spec
    this.agentState = agentState
    const configDir = spec.configDir ? expandHome(spec.configDir) : os.homedir()
    const skillsDir = spec.skillsDir ? expandHome(spec.skillsDir) : path.join(configDir, 'skills')
    this.info = {
      id: spec.id,
      displayName: spec.displayName,
      configDir,
      skillsDir,
      models: spec.models ?? [],
      defaultModel: spec.defaultModel,
      // Probe binary by name (absolute paths are also accepted by
      // hasBinary via early existsSync of `name` itself). If binary
      // isn't found, the menu will gray it out as "(未安装)".
      available: hasBinary(spec.binary)
    }
  }

  send(
    content: ChatContent[],
    options: SendOptions,
    callbacks: ChatTurnCallbacks
  ): Promise<string> {
    return new Promise((resolve) => {
      const promptText = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text as string)
        .join('\n')

      const args = (this.spec.args ?? []).map((a) =>
        a
          .replace(/{prompt}/g, this.spec.stdinPrompt ? '' : promptText)
          .replace(/{model}/g, options.model ?? this.spec.defaultModel ?? '')
          .replace(/{sessionId}/g, options.sessionId ?? '')
      )

      const proc: ChildProcess = spawn(this.spec.binary, args, {
        cwd: options.cwd ?? os.homedir(),
        env: {
          ...process.env,
          PATH: spawnPath(),
          ...(this.spec.env ?? {})
        }
      })
      // Flash 'jumping' → POST_JUMPING_STATE so the pet sprite + label
      // reflect that this custom provider has started. Without this the
      // bubble would just sit on the generic "对方正在输入" placeholder.
      this.agentState?.handleHook(this.spec.id, 'user')

      let stdoutBuf = ''
      let accumulatedText = ''
      let stderrBuf = ''
      const eventsKind = this.spec.events?.kind ?? 'text-stream'

      proc.stdout?.on('data', (chunk: Buffer) => {
        const s = chunk.toString('utf-8')
        if (eventsKind === 'text-stream') {
          accumulatedText += s
          callbacks.onChunk?.(s)
        } else {
          stdoutBuf += s
          let nl: number
          while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
            const line = stdoutBuf.slice(0, nl).trim()
            stdoutBuf = stdoutBuf.slice(nl + 1)
            if (!line) continue
            try {
              const event = JSON.parse(line)
              const textPath = this.spec.events?.textPath
              if (textPath) {
                const t = getByPath(event, textPath)
                if (typeof t === 'string' && t.length > 0) {
                  // Treat each as a chunk (caller can de-dup if needed)
                  accumulatedText += t
                  callbacks.onChunk?.(t)
                }
              }
            } catch {
              // ignore malformed
            }
          }
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8')
      })

      proc.on('error', (err) => {
        callbacks.onError?.(err.message)
        resolve('')
      })

      proc.on('exit', (code) => {
        // Always release the agent state on exit so the bubble doesn't
        // stay stuck on the last status.
        this.agentState?.handleHook(this.spec.id, 'stop')
        if (code !== 0) {
          const msg = stderrBuf.trim() || `${this.spec.binary} exited with code ${code}`
          callbacks.onError?.(msg)
          resolve('')
          return
        }
        callbacks.onDone?.(accumulatedText)
        resolve(accumulatedText)
      })

      if (this.spec.stdinPrompt && promptText) {
        proc.stdin?.write(promptText)
      }
      proc.stdin?.end()
    })
  }
}
