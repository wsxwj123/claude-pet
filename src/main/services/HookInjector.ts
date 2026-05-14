import fs from 'fs'
import path from 'path'
import os from 'os'

/**
 * Hook injection for all supported coding agents.
 *
 * Strict rules across every agent target:
 *   - Only the relevant hooks section is touched. Every other top-level
 *     setting in the file is preserved verbatim.
 *   - Re-injection is idempotent. Existing claude-pets entries are removed
 *     first and rewritten, so format upgrades happen automatically.
 *   - Existing third-party hooks (e.g. petdex's :7777 entries) are left
 *     alone — our entries live alongside them.
 *
 * Sources and shapes by agent:
 *   - Claude Code: ~/.claude/settings.json — hooks under `.hooks`, Anthropic format
 *   - Codex CLI:    ~/.codex/hooks.json     — same JSON shape; ALSO needs
 *                   `[features] hooks = true` in ~/.codex/config.toml
 *   - opencode:     ~/.config/opencode/plugins/claude-pets.js — JS module
 *                   (no JSON config — we write/rewrite this whole file)
 */

// Two ways our hook can be recognized in a settings file:
//   1. New helper-based format → command contains "claude-pets-hook"
//   2. Legacy curl format from earlier dev iterations → command contains
//      "127.0.0.1:7779/bubble" (our HookServer endpoint)
// Both must be purged when re-injecting so the same event doesn't get
// fired multiple times.
const HOOK_MARKERS = ['claude-pets-hook', '127.0.0.1:7779/bubble']
const OPENCODE_PLUGIN_MARKER = '/* claude-pets opencode plugin */'

// Claude Code's hook event names. Codex uses the same set + PermissionRequest.
const CLAUDE_EVENTS: Array<{ event: string; kind: string }> = [
  { event: 'UserPromptSubmit', kind: 'user' },
  { event: 'PreToolUse', kind: 'pre' },
  { event: 'PostToolUse', kind: 'post' },
  { event: 'Stop', kind: 'stop' },
  { event: 'Notification', kind: 'notif' }
]

const CODEX_EVENTS: Array<{ event: string; kind: string }> = [
  { event: 'UserPromptSubmit', kind: 'user' },
  { event: 'PreToolUse', kind: 'pre' },
  { event: 'PostToolUse', kind: 'post' },
  { event: 'Stop', kind: 'stop' },
  // Codex uses PermissionRequest where Claude Code uses Notification
  { event: 'PermissionRequest', kind: 'notif' }
]

interface HookEntry {
  type: string
  command: string
  [key: string]: unknown
}
interface HookGroup {
  matcher?: string
  hooks: HookEntry[]
}
type HooksMap = Record<string, HookGroup[]>

export interface AgentInjectionResult {
  name: string
  agentSource: string
  status: 'injected' | 'unsupported' | 'no-helper' | 'error' | 'skipped'
  error?: string
  notes?: string[]
}

function buildCommand(helperPath: string, kind: string, agentSource: string): string {
  return `node "${helperPath}" ${kind} ${agentSource} >/dev/null 2>&1 || true`
}

function isOurEntry(h: HookEntry): boolean {
  if (typeof h.command !== 'string') return false
  return HOOK_MARKERS.some((m) => h.command.includes(m))
}

function purgeOurEntries(hooks: HooksMap): void {
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event]
    if (!Array.isArray(groups)) continue
    const cleaned: HookGroup[] = []
    for (const g of groups) {
      if (!Array.isArray(g.hooks)) {
        cleaned.push(g)
        continue
      }
      const remaining = g.hooks.filter((h) => !isOurEntry(h))
      if (remaining.length > 0) cleaned.push({ ...g, hooks: remaining })
    }
    if (cleaned.length > 0) hooks[event] = cleaned
    else delete hooks[event]
  }
}

// ─── Claude Code ──────────────────────────────────────────────────────

function injectClaudeCode(helperPath: string): AgentInjectionResult {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  return injectJsonSettings({
    name: 'Claude Code',
    agentSource: 'claude-code',
    settingsPath,
    helperPath,
    events: CLAUDE_EVENTS
  })
}

// ─── Codex CLI ────────────────────────────────────────────────────────

function injectCodex(helperPath: string): AgentInjectionResult {
  const hooksPath = path.join(os.homedir(), '.codex', 'hooks.json')
  const result = injectJsonSettings({
    name: 'Codex',
    agentSource: 'codex',
    settingsPath: hooksPath,
    helperPath,
    events: CODEX_EVENTS
  })
  if (result.status !== 'injected') return result

  // Codex only loads hooks.json when [features] hooks = true.
  const tomlPath = path.join(os.homedir(), '.codex', 'config.toml')
  const featureNote = ensureCodexFeatureFlag(tomlPath)
  result.notes = result.notes ?? []
  result.notes.push(featureNote)
  return result
}

function injectJsonSettings(args: {
  name: string
  agentSource: string
  settingsPath: string
  helperPath: string
  events: Array<{ event: string; kind: string }>
}): AgentInjectionResult {
  if (!fs.existsSync(args.helperPath)) {
    return {
      name: args.name,
      agentSource: args.agentSource,
      status: 'no-helper',
      error: `helper not found: ${args.helperPath}`
    }
  }
  try {
    if (!fs.existsSync(args.settingsPath)) {
      fs.mkdirSync(path.dirname(args.settingsPath), { recursive: true })
      fs.writeFileSync(args.settingsPath, '{}\n', 'utf-8')
    }
    const raw = fs.readFileSync(args.settingsPath, 'utf-8')
    let settings: { hooks?: HooksMap; [k: string]: unknown }
    try {
      settings = raw.trim() ? JSON.parse(raw) : {}
    } catch (err) {
      return {
        name: args.name,
        agentSource: args.agentSource,
        status: 'error',
        error: 'JSON 解析失败: ' + (err instanceof Error ? err.message : String(err))
      }
    }
    if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}

    purgeOurEntries(settings.hooks)

    for (const { event, kind } of args.events) {
      const groups = (settings.hooks[event] ||= [])
      groups.push({
        hooks: [
          {
            type: 'command',
            command: buildCommand(args.helperPath, kind, args.agentSource)
          }
        ]
      })
    }

    const trailingNewline = raw.endsWith('\n') ? '\n' : ''
    fs.writeFileSync(
      args.settingsPath,
      JSON.stringify(settings, null, 2) + trailingNewline,
      'utf-8'
    )
    return { name: args.name, agentSource: args.agentSource, status: 'injected' }
  } catch (err) {
    return {
      name: args.name,
      agentSource: args.agentSource,
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Make sure [features].hooks = true is present in ~/.codex/config.toml.
 * Section-aware line walker — never rewrites unrelated structure. Backs up
 * the existing file before mutating.
 */
function ensureCodexFeatureFlag(tomlPath: string): string {
  let text: string
  let existed = true
  try {
    text = fs.readFileSync(tomlPath, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      return `config.toml 读取失败 (${code ?? 'io_error'})；请手动添加 [features].hooks = true`
    }
    text = ''
    existed = false
  }

  if (!existed) {
    try {
      fs.mkdirSync(path.dirname(tomlPath), { recursive: true })
      fs.writeFileSync(tomlPath, '[features]\nhooks = true\n', 'utf-8')
      return '已创建 config.toml 并启用 hooks'
    } catch (err) {
      return `创建 config.toml 失败: ${(err as Error).message}`
    }
  }

  // Codex 0.130+ renamed `[features].codex_hooks` → `[features].hooks`.
  // Migrate the old key in-place so user no longer sees the deprecation
  // warning each codex invocation.
  let migrated = false
  if (/^\s*codex_hooks\s*=/m.test(text)) {
    text = text.replace(/^(\s*)codex_hooks(\s*=)/gm, '$1hooks$2')
    migrated = true
  }
  const lines = text.split('\n')
  const sectionRe = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/
  const keyRe = /^\s*hooks\s*=\s*(.+?)\s*(?:#.*)?$/

  let currentSection: string | null = null
  let featuresLine: number | null = null
  let keyState: 'enabled' | 'wrong' | 'missing' = 'missing'
  let keyLineIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const sectionMatch = lines[i].match(sectionRe)
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim()
      if (currentSection === 'features' && featuresLine === null) featuresLine = i
      continue
    }
    if (currentSection !== 'features') continue
    const km = lines[i].match(keyRe)
    if (!km) continue
    keyLineIndex = i
    keyState = km[1].trim() === 'true' ? 'enabled' : 'wrong'
    break
  }

  if (keyState === 'enabled' && !migrated) return 'hooks 已启用'
  if (keyState === 'enabled' && migrated) {
    // After rename, we still need to write the migrated text back.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.writeFileSync(`${tomlPath}.${stamp}.bak`, lines.join('\n'), 'utf-8')
      fs.writeFileSync(tomlPath, text, 'utf-8')
      return 'hooks 已启用（从 codex_hooks 迁移）'
    } catch (err) {
      return `migration 写回失败: ${(err as Error).message}`
    }
  }

  // Back up before mutating
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.writeFileSync(`${tomlPath}.${stamp}.bak`, text, 'utf-8')
  } catch (err) {
    return `备份 config.toml 失败: ${(err as Error).message}`
  }

  let next: string
  if (keyState === 'wrong') {
    const valueRe = /^(\s*hooks\s*=\s*)([^#\n]+?)(\s*(?:#.*)?)$/
    const m = lines[keyLineIndex].match(valueRe)
    lines[keyLineIndex] = m ? `${m[1]}true${m[3]}` : 'hooks = true'
    next = lines.join('\n')
  } else if (featuresLine !== null) {
    lines.splice(featuresLine + 1, 0, 'hooks = true')
    next = lines.join('\n')
  } else {
    const sep = text.endsWith('\n') || text.length === 0 ? '' : '\n'
    next = `${text}${sep}\n[features]\nhooks = true\n`
  }

  try {
    fs.writeFileSync(tomlPath, next, 'utf-8')
    return '已在 [features] 启用 hooks（旧文件已备份 .bak）'
  } catch (err) {
    return `写入 config.toml 失败: ${(err as Error).message}`
  }
}

// ─── opencode ─────────────────────────────────────────────────────────

function resolveOpencodeConfigDir(): string {
  const env = process.env
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'opencode')
  return path.join(os.homedir(), '.config', 'opencode')
}

function injectOpencode(_helperPath: string): AgentInjectionResult {
  const dir = resolveOpencodeConfigDir()
  const pluginPath = path.join(dir, 'plugins', 'claude-pets.js')
  const configPath = path.join(dir, 'opencode.json')
  const notes: string[] = []

  try {
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true })
    fs.writeFileSync(pluginPath, opencodePluginSource(), 'utf-8')
    notes.push(`plugin 已写入 ${pluginPath}`)
  } catch (err) {
    return {
      name: 'opencode',
      agentSource: 'opencode',
      status: 'error',
      error: 'plugin 写入失败: ' + (err instanceof Error ? err.message : String(err))
    }
  }

  // Register the plugin path in opencode.json. Required: opencode loads
  // plugins from the explicit `plugin` array, not by scanning plugins/.
  // Only this single field is touched — every other key (model, mcp,
  // provider, ...) is left exactly as it was.
  try {
    if (!fs.existsSync(configPath)) {
      // opencode runs fine without a config file; if missing, create a
      // minimal one carrying just our plugin. Users who never had a
      // config don't need anything else for the plugin to load.
      fs.writeFileSync(
        configPath,
        JSON.stringify({ plugin: [pluginPath] }, null, 2) + '\n',
        'utf-8'
      )
      notes.push(`已创建 ${configPath} 并注册 plugin`)
      return { name: 'opencode', agentSource: 'opencode', status: 'injected', notes }
    }

    const raw = fs.readFileSync(configPath, 'utf-8')
    let config: { plugin?: unknown[]; [k: string]: unknown }
    try {
      config = raw.trim() ? JSON.parse(raw) : {}
    } catch (err) {
      return {
        name: 'opencode',
        agentSource: 'opencode',
        status: 'error',
        error:
          'opencode.json 解析失败: ' + (err instanceof Error ? err.message : String(err))
      }
    }

    const plugins = Array.isArray(config.plugin) ? [...config.plugin] : []
    const alreadyRegistered = plugins.some((p) => {
      if (typeof p === 'string') return p === pluginPath
      if (Array.isArray(p) && typeof p[0] === 'string') return p[0] === pluginPath
      return false
    })
    if (!alreadyRegistered) {
      plugins.push(pluginPath)
      config.plugin = plugins
      const trailingNewline = raw.endsWith('\n') ? '\n' : ''
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + trailingNewline, 'utf-8')
      notes.push('已在 opencode.json 的 plugin 数组中注册')
    } else {
      notes.push('opencode.json 中已注册过 plugin')
    }
  } catch (err) {
    return {
      name: 'opencode',
      agentSource: 'opencode',
      status: 'error',
      error: 'opencode.json 更新失败: ' + (err instanceof Error ? err.message : String(err))
    }
  }

  return { name: 'opencode', agentSource: 'opencode', status: 'injected', notes }
}

/**
 * The opencode plugin body. Inlined so we can ship as a single file with
 * no external runtime deps. Uses node http directly so it works whether
 * the host bun/node has fetch or not (older bun runtimes vary).
 */
function opencodePluginSource(): string {
  return `${OPENCODE_PLUGIN_MARKER}
// claude-pets opencode plugin. Auto-generated. Forwards opencode lifecycle
// events to the claude-pets HookServer on http://127.0.0.1:7779/bubble.

import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 7779;
const PATH = "/bubble";

function post(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 300
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      }
    );
    req.on("error", () => resolve());
    req.on("timeout", () => {
      try { req.destroy(); } catch {}
      resolve();
    });
    req.write(body);
    req.end();
  });
}

const PetdexClaudeHooks = {
  "tool.execute.before": async (input, output) => {
    await post({
      kind: "pre",
      agent_source: "opencode",
      tool_name: input?.tool ?? null,
      tool_input: output?.args ?? null
    });
  },
  "tool.execute.after": async (input) => {
    await post({
      kind: "post",
      agent_source: "opencode",
      tool_name: input?.tool ?? null,
      tool_input: input?.args ?? null
    });
  },
  "chat.message": async () => {
    await post({ kind: "user", agent_source: "opencode" });
  },
  event: async ({ event }) => {
    if (!event || typeof event.type !== "string") return;
    if (event.type === "session.idle") {
      await post({ kind: "stop", agent_source: "opencode" });
    } else if (event.type === "session.error") {
      await post({ kind: "stop", agent_source: "opencode" });
    } else if (event.type === "permission.required" || event.type === "permission.ask") {
      await post({ kind: "notif", agent_source: "opencode" });
    }
  }
};

const ClaudePetsOpencodePlugin = async () => PetdexClaudeHooks;

export default ClaudePetsOpencodePlugin;
export { ClaudePetsOpencodePlugin };
`
}

// ─── Public API ───────────────────────────────────────────────────────

export function injectAllHooks(helperPath: string): AgentInjectionResult[] {
  return [
    injectClaudeCode(helperPath),
    injectCodex(helperPath),
    injectOpencode(helperPath)
  ]
}

export function getInjectionStatus(): Array<{
  name: string
  agentSource: string
  installed: boolean
  eventCount: number
}> {
  const home = os.homedir()
  const results: Array<{ name: string; agentSource: string; installed: boolean; eventCount: number }> = []

  // Claude Code
  results.push(statusFromJson('Claude Code', 'claude-code', path.join(home, '.claude', 'settings.json'), CLAUDE_EVENTS))
  // Codex
  results.push(statusFromJson('Codex', 'codex', path.join(home, '.codex', 'hooks.json'), CODEX_EVENTS))
  // opencode
  const ocDir = resolveOpencodeConfigDir()
  const ocPath = path.join(ocDir, 'plugins', 'claude-pets.js')
  let ocInstalled = false
  try {
    if (fs.existsSync(ocPath)) {
      const c = fs.readFileSync(ocPath, 'utf-8')
      ocInstalled = c.includes(OPENCODE_PLUGIN_MARKER)
    }
  } catch {
    // ignore
  }
  results.push({
    name: 'opencode',
    agentSource: 'opencode',
    installed: ocInstalled,
    eventCount: ocInstalled ? 4 : 0
  })

  return results
}

function statusFromJson(
  name: string,
  agentSource: string,
  settingsPath: string,
  events: Array<{ event: string; kind: string }>
): { name: string; agentSource: string; installed: boolean; eventCount: number } {
  try {
    if (!fs.existsSync(settingsPath)) {
      return { name, agentSource, installed: false, eventCount: 0 }
    }
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const settings = raw.trim() ? JSON.parse(raw) : {}
    let count = 0
    for (const { event } of events) {
      const groups = settings.hooks?.[event]
      if (groups?.some?.((g: HookGroup) => g.hooks?.some(isOurEntry))) count++
    }
    return { name, agentSource, installed: count > 0, eventCount: count }
  } catch {
    return { name, agentSource, installed: false, eventCount: 0 }
  }
}
