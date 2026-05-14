#!/usr/bin/env node
// claude-pets-hook <kind> <agent_source>
//
// Invoked by Claude Code / Codex / opencode hook commands. Reads the
// agent's JSON payload from stdin, picks out tool_name + tool_input,
// and POSTs everything to the claude-pets HookServer on :7779.
//
// Must exit quickly and silently — agents block on hook execution.

const http = require('http')

const [, , kindArg, agentArg] = process.argv
const kind = kindArg || 'unknown'
const agentSource = agentArg || 'unknown'

let buf = ''
let sent = false

function send(payload) {
  if (sent) return
  sent = true
  const body = JSON.stringify(payload)
  const req = http.request(
    {
      host: '127.0.0.1',
      port: 7779,
      path: '/bubble',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 250
    },
    (res) => {
      res.resume()
      res.on('end', () => process.exit(0))
    }
  )
  req.on('error', () => process.exit(0))
  req.on('timeout', () => {
    try { req.destroy() } catch {}
    process.exit(0)
  })
  req.write(body)
  req.end()
}

function finish() {
  let parsed = null
  try {
    if (buf.trim()) parsed = JSON.parse(buf)
  } catch {
    // malformed payload — proceed with no extra info
  }
  send({
    kind,
    agent_source: agentSource,
    tool_name: parsed?.tool_name ?? null,
    tool_input: parsed?.tool_input ?? null,
    hook_event_name: parsed?.hook_event_name ?? null,
    session_id: parsed?.session_id ?? null,
    // Caller PID lets the server walk the process tree to find the
    // owning terminal / GUI app, so the user can double-click the pet
    // to jump back to the agent window.
    caller_pid: process.ppid
  })
}

process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => { buf += chunk })
process.stdin.on('end', finish)

// Safety net: if stdin gives no EOF within 200ms, send with whatever
// we have. Agents always close stdin promptly, but never block.
setTimeout(finish, 200)

// Hard cap: never run longer than 350ms.
setTimeout(() => {
  if (!sent) process.exit(0)
}, 350)
