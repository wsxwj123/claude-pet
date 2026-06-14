import { spawn, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import { Provider, ProviderInfo, ChatContent, ChatTurnCallbacks, SendOptions } from './Provider'
import { hasBinary, spawnPath, resolveSpawn } from '../platform'

/**
 * Claude Code CLI provider.
 *
 * Invokes `claude -p --input-format stream-json --output-format stream-json --verbose`.
 * Spawns once per turn, sends one JSON user line on stdin, closes stdin
 * to signal end-of-turn, then parses line-delimited JSON on stdout.
 *
 * Events of interest:
 *   - {type:"system",subtype:"init",session_id} → first turn provides the
 *     Claude session id we can use with --resume next time
 *   - {type:"assistant",message:{content:[{type:"text",text}]}} → emit
 *     assistant chunks. Claude Code emits the FULL accumulated content
 *     each event, so we send only the delta to keep the renderer's
 *     streaming illusion correct.
 *   - {type:"result",subtype:"success"|...,result,is_error} → completion
 */
export class ClaudeCliProvider implements Provider {
  readonly info: ProviderInfo

  private claudeBin: string

  constructor(claudeBin = 'claude') {
    this.claudeBin = claudeBin
    // Detect at construction so the menu shows the correct
    // available/unavailable state. Cheap (existsSync probes).
    this.info = {
      id: 'claude-cli',
      displayName: 'Claude Code',
      configDir: path.join(os.homedir(), '.claude'),
      skillsDir: path.join(os.homedir(), '.claude', 'skills'),
      models: ['sonnet', 'opus', 'haiku'],
      defaultModel: 'sonnet',
      available: hasBinary(claudeBin)
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
      if (options.sessionId) {
        args.push('--resume', options.sessionId)
      }
      if (options.model) {
        args.push('--model', options.model)
      }

      const { command, shell } = resolveSpawn(this.claudeBin)
      const proc: ChildProcess = spawn(command, args, {
        cwd: options.cwd ?? os.homedir(),
        env: {
          ...process.env,
          PATH: spawnPath()
        },
        shell
      })

      let stdoutBuf = ''
      let stderrBuf = ''
      let lastAssistantText = ''
      let finalResult: string | null = null
      let errorMsg: string | null = null
      // Guard so error+exit can't both fire callbacks (a ghost onDone
      // after onError would corrupt the renderer's chat state).
      let finished = false

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8')
        let nl: number
        while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, nl)
          stdoutBuf = stdoutBuf.slice(nl + 1)
          if (!line.trim()) continue
          this.handleStdoutLine(line, lastAssistantText, callbacks, (newAssistantText, fr, em) => {
            if (newAssistantText !== null) lastAssistantText = newAssistantText
            if (fr !== null) finalResult = fr
            if (em !== null) errorMsg = em
          })
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8')
      })

      proc.on('error', (err) => {
        if (finished) return
        finished = true
        console.error('[ClaudeCliProvider] spawn error:', err.message)
        callbacks.onError?.(err.message)
        resolve('')
      })

      proc.on('exit', (code) => {
        if (finished) return
        finished = true
        console.log(
          `[ClaudeCliProvider] exit code=${code} resultLen=${finalResult?.length ?? 0} stderr=${stderrBuf.trim().slice(0, 200)}`
        )
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
          const msg = stderrBuf.trim() || `claude exited with code ${code}`
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
    ) => void
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
      return
    }

    if (e.type === 'assistant') {
      const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined
      const text = (msg?.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('')
      if (text) {
        // Claude Code emits the FULL accumulated text each event — send
        // only the delta to keep our streaming illusion correct.
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
        update(null, null, text || 'claude returned an error')
      } else {
        update(null, text, null)
      }
      return
    }
  }
}
