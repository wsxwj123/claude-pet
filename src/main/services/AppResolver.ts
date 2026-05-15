import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

/**
 * Walk a macOS process tree to find the owning GUI app for an agent
 * lifecycle hook. The pid we receive is the immediate parent of our
 * Node helper — typically the agent CLI itself. We follow PPIDs upward
 * until we hit a process whose name matches a known GUI app (Terminal,
 * iTerm2, WezTerm, Claude, Codex, …) or until we reach launchd (pid 1).
 */

interface ProcInfo {
  pid: number
  ppid: number
  comm: string
}

const TERMINAL_NAMES = new Set([
  'Terminal',
  'iTerm2',
  'iTerm',
  'WezTerm',
  'Alacritty',
  'kitty',
  'Hyper',
  'Warp',
  'tabby',
  'Tabby',
  'Ghostty'
])

const KNOWN_AGENT_APPS = new Set(['Claude', 'Codex'])

// pid → comm/ppid cache. Process info is effectively immutable for the
// lifetime of a pid, so we never expire. Bounded by how many distinct
// pids we resolve in a session — small.
const procCache = new Map<number, ProcInfo | null>()

async function getProc(pid: number): Promise<ProcInfo | null> {
  if (procCache.has(pid)) return procCache.get(pid) ?? null
  try {
    const { stdout } = await execFileP(
      'ps',
      ['-o', 'pid=,ppid=,comm=', '-p', String(pid)],
      { timeout: 500 }
    )
    const out = stdout.trim()
    if (!out) {
      procCache.set(pid, null)
      return null
    }
    const m = out.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) {
      procCache.set(pid, null)
      return null
    }
    const info: ProcInfo = { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3].trim() }
    procCache.set(pid, info)
    return info
  } catch {
    procCache.set(pid, null)
    return null
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * Returns the macOS application name that should be activated to bring
 * the user back to the agent UI, or null if we can't determine one.
 * Async so the main event loop isn't blocked while shelling out to ps
 * up to 12 times during hot hook traffic.
 *
 * Non-macOS platforms return null immediately — `ps` flag syntax + the
 * Mac-specific TERMINAL_NAMES / KNOWN_AGENT_APPS list don't translate
 * to Windows or Linux GUI app discovery anyway.
 */
export async function resolveOwningApp(pid: number): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  let current = pid
  for (let depth = 0; depth < 12; depth++) {
    const info = await getProc(current)
    if (!info) return null
    const name = basename(info.comm)
    if (KNOWN_AGENT_APPS.has(name)) return name
    if (TERMINAL_NAMES.has(name)) return name
    if (info.ppid <= 1) return null
    current = info.ppid
  }
  return null
}
