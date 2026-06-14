import http from 'http'
import { AgentStateManager, HookKind } from './AgentStateManager'
import { resolveOwningApp } from './AppResolver'

const PORT = 7779

export class HookServer {
  private server: http.Server
  private agentState: AgentStateManager

  constructor(agentState: AgentStateManager) {
    this.agentState = agentState
    this.server = http.createServer(this.handleRequest.bind(this))
  }

  start(): void {
    this.server.listen(PORT, '127.0.0.1', () => {
      console.log(`[HookServer] Listening on http://127.0.0.1:${PORT}`)
    })
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[HookServer] Port ${PORT} already in use, hook server not started`)
      } else {
        console.error('[HookServer] Error:', err)
      }
    })
  }

  stop(): void {
    this.server.close()
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && req.url === '/bubble') {
      let body = ''
      let oversize = false
      req.on('data', (chunk) => {
        if (oversize) return
        body += chunk.toString()
        if (body.length > 65536) {
          // Guard against a second oversize chunk re-sending headers,
          // which would throw ERR_HTTP_HEADERS_SENT.
          oversize = true
          res.writeHead(413)
          res.end('Payload too large')
          req.destroy()
        }
      })
      req.on('end', () => {
        if (oversize) return
        try {
          const payload = JSON.parse(body) as {
            kind?: string
            agent_source?: string
            tool_name?: string | null
            tool_input?: Record<string, unknown> | null
            caller_pid?: number
          }
          const kind = payload.kind as HookKind | undefined
          const agentSource = payload.agent_source ?? 'claude-code'
          const validKinds: HookKind[] = ['pre', 'post', 'user', 'stop', 'notif']
          if (!kind || !validKinds.includes(kind)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid kind' }))
            return
          }

          console.log(
            `[HookServer] ${agentSource}/${kind}` +
              (payload.tool_name ? ` tool=${payload.tool_name}` : '')
          )
          // Respond fast — push the state update first, then resolve
          // the owning macOS app asynchronously so the agent CLI's
          // hook script isn't held up waiting on `ps` chains.
          this.agentState.handleHook(
            agentSource,
            kind,
            {
              toolName: payload.tool_name ?? null,
              toolInput: payload.tool_input ?? null
            }
          )
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))

          if (payload.caller_pid && (kind === 'pre' || kind === 'user')) {
            // Fire-and-forget. Result is fed back into agentState so
            // double-click "jump to agent app" still works, just with
            // a brief delay on the first turn.
            resolveOwningApp(payload.caller_pid)
              .then((owningApp) => {
                if (owningApp) {
                  this.agentState.handleHook(
                    agentSource,
                    kind,
                    {
                      toolName: payload.tool_name ?? null,
                      toolInput: payload.tool_input ?? null
                    },
                    owningApp
                  )
                }
              })
              .catch(() => undefined)
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not found')
  }
}
