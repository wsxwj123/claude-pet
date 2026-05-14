import type { AnimState, HookKind, DisplayState } from '../../shared/types'
import path from 'path'

export type { AnimState, HookKind, DisplayState }

const FLASH_STATE_DURATION: Partial<Record<AnimState, number>> = {
  // jumping is a brief "got it!" bounce after the user submits a prompt.
  // Afterwards we want the pet to look like it's *thinking* until the
  // agent actually starts using tools — handled by transitioning to
  // the review (thinking) state via JUMPING_TO_REVIEW_MS below.
  jumping: 600,
  waving: 1500
}

// After the jumping flash ends from a UserPromptSubmit, switch to the
// review (thinking) state and hold it until the next pre/post/stop
// arrives. Without this the pet returns to idle and looks like nothing
// is happening even though the agent is actually working on the prompt.
const POST_JUMPING_STATE: AnimState = 'review'

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
  opencode: 'opencode'
}

// Fallback per-state text when no specific tool context is available.
const GENERIC_STATE_TEXT: Record<AnimState, string> = {
  idle: '空闲',
  'running-right': '运行中…',
  'running-left': '运行中…',
  waving: '完成',
  jumping: '收到',
  failed: '失败',
  waiting: '等待中…',
  running: '运行中…',
  review: '思考中…'
}

interface ToolContext {
  toolName: string | null
  toolInput: Record<string, unknown> | null
}

interface AgentEntry {
  state: AnimState
  lastActiveAt: number
  flashTimer?: ReturnType<typeof setTimeout>
  // Latest label text — set when state changes. Frozen for flash states.
  labelText?: string | null
  // macOS app name to activate when user double-clicks the pet.
  owningApp?: string | null
}

type StateChangeCallback = (display: DisplayState) => void

function clip(s: string, max = 28): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function field(input: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  if (!input) return undefined
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/**
 * Generate the bubble text for a state, mimicking petdex's per-tool
 * contextual labels. `past` switches between present-progressive
 * ("Reading foo.ts") and past-tense ("Read foo.ts") forms.
 */
function toolText(tool: ToolContext, past: boolean): string | null {
  const name = (tool.toolName ?? '').toLowerCase()
  if (!name) return null
  const input = tool.toolInput

  switch (name) {
    case 'read': {
      const p = field(input, 'file_path', 'filePath', 'path')
      const base = p ? path.basename(p) : null
      return base ? (past ? `已读 ${clip(base)}` : `读取 ${clip(base)}`) : past ? '已读文件' : '读取文件'
    }
    case 'edit':
    case 'multiedit':
    case 'multi_edit': {
      const p = field(input, 'file_path', 'filePath', 'path')
      const base = p ? path.basename(p) : null
      return base ? (past ? `已改 ${clip(base)}` : `修改 ${clip(base)}`) : past ? '已改文件' : '修改文件'
    }
    case 'write': {
      const p = field(input, 'file_path', 'filePath', 'path')
      const base = p ? path.basename(p) : null
      return base ? (past ? `已写 ${clip(base)}` : `写入 ${clip(base)}`) : past ? '已写文件' : '写入文件'
    }
    case 'bash':
    case 'shell': {
      const cmd = field(input, 'command', 'cmd')
      if (cmd) {
        const head = clip(cmd.split(/\s+/)[0] || cmd, 24)
        return past ? `运行完 ${head}` : `运行 ${head}`
      }
      return past ? '命令完成' : '执行命令'
    }
    case 'grep':
    case 'search': {
      const pattern = field(input, 'pattern', 'query')
      return pattern
        ? past
          ? `搜索 ${clip(pattern, 24)} 完成`
          : `搜索 ${clip(pattern, 24)}`
        : past
        ? '搜索完成'
        : '搜索中'
    }
    case 'glob':
    case 'list_files': {
      const pattern = field(input, 'pattern', 'path')
      return pattern
        ? past
          ? `列出 ${clip(pattern, 24)}`
          : `查找 ${clip(pattern, 24)}`
        : past
        ? '已列出文件'
        : '列出文件'
    }
    case 'webfetch':
    case 'web_fetch':
    case 'fetch': {
      const url = field(input, 'url')
      if (url) {
        try {
          const host = new URL(url).host
          return past ? `已获取 ${clip(host, 24)}` : `获取 ${clip(host, 24)}`
        } catch {
          return past ? '已获取网页' : '获取网页'
        }
      }
      return past ? '已获取网页' : '获取网页'
    }
    case 'websearch':
    case 'web_search': {
      const q = field(input, 'query', 'q')
      return q ? (past ? `搜完 ${clip(q, 22)}` : `搜索 ${clip(q, 22)}`) : past ? '搜索完成' : '联网搜索'
    }
    case 'task':
    case 'agent': {
      return past ? '子代理完成' : '启动子代理'
    }
    case 'todowrite':
    case 'todo_write': {
      return past ? '已更新待办' : '更新待办'
    }
    case 'notebookedit':
    case 'notebook_edit': {
      return past ? '已改 notebook' : '改 notebook'
    }
    default: {
      return past ? `已用 ${clip(tool.toolName ?? 'tool')}` : `调用 ${clip(tool.toolName ?? 'tool')}`
    }
  }
}

function stateLabel(state: AnimState, tool: ToolContext): string {
  switch (state) {
    case 'running': {
      const t = toolText(tool, false)
      return t ?? GENERIC_STATE_TEXT.running
    }
    case 'idle': {
      // post: show "Read foo.ts" briefly via flash? No — post immediately
      // returns to idle which hides the label. So past-tense isn't shown.
      // (We still expose it for callers that want it.)
      return GENERIC_STATE_TEXT.idle
    }
    default:
      return GENERIC_STATE_TEXT[state]
  }
}

export class AgentStateManager {
  private agents = new Map<string, AgentEntry>()
  private onChangeCallbacks: StateChangeCallback[] = []
  // Remember the latest tool seen for an agent so we can render
  // contextual text even on subsequent ticks of the same state.
  private lastTool = new Map<string, ToolContext>()

  onStateChange(cb: StateChangeCallback): void {
    this.onChangeCallbacks.push(cb)
  }

  handleHook(
    agentSource: string,
    kind: HookKind,
    tool?: ToolContext,
    owningApp?: string | null
  ): void {
    const newState = this.kindToState(kind)
    const entry = this.agents.get(agentSource) ?? { state: 'idle', lastActiveAt: 0 }

    if (tool) {
      this.lastTool.set(agentSource, tool)
    }
    const currentTool = this.lastTool.get(agentSource) ?? { toolName: null, toolInput: null }

    if (entry.flashTimer) {
      clearTimeout(entry.flashTimer)
      entry.flashTimer = undefined
    }

    entry.state = newState
    entry.lastActiveAt = Date.now()
    entry.labelText = stateLabel(newState, currentTool)
    if (owningApp != null) entry.owningApp = owningApp

    const flashDuration = FLASH_STATE_DURATION[newState]
    if (flashDuration) {
      const fromState = newState
      entry.flashTimer = setTimeout(() => {
        const e = this.agents.get(agentSource)
        if (e) {
          // user-prompt jumping → transition to "thinking" rather than
          // idle so the user sees the agent is still working.
          if (fromState === 'jumping') {
            const latestTool =
              this.lastTool.get(agentSource) ?? { toolName: null, toolInput: null }
            e.state = POST_JUMPING_STATE
            e.labelText = stateLabel(POST_JUMPING_STATE, latestTool)
          } else {
            e.state = 'idle'
            e.labelText = null
          }
          e.flashTimer = undefined
        }
        this.emit()
      }, flashDuration)
    }

    this.agents.set(agentSource, entry)
    this.emit()
  }

  private kindToState(kind: HookKind): AnimState {
    switch (kind) {
      case 'pre':
        return 'running'
      case 'post':
        return 'idle'
      case 'user':
        return 'jumping'
      case 'stop':
        return 'waving'
      case 'notif':
        return 'waiting'
    }
  }

  private computeDisplay(): DisplayState {
    if (this.agents.size === 0) {
      return { animState: 'idle', labelText: null }
    }

    // Gather all agents whose state warrants a label (flash state OR
    // any non-idle state). Sort by lastActiveAt desc so the most recent
    // one shows on top and drives the sprite animation.
    const active: Array<{ id: string; entry: AgentEntry }> = []
    for (const [id, entry] of this.agents) {
      if (entry.flashTimer !== undefined || entry.state !== 'idle') {
        active.push({ id, entry })
      }
    }
    if (active.length === 0) {
      return { animState: 'idle', labelText: null }
    }
    active.sort((a, b) => b.entry.lastActiveAt - a.entry.lastActiveAt)

    // Sprite animation tracks the most recent agent (only one body,
    // one animation). Label is a multi-line stack — one line per agent.
    const lines = active
      .map(({ id, entry }) => this.formatLabel(id, entry.labelText))
      .filter((s): s is string => !!s)

    return {
      animState: active[0].entry.state,
      labelText: lines.length > 0 ? lines.join('\n') : null
    }
  }

  private formatLabel(agentId: string, stateText: string | null | undefined): string | null {
    if (!stateText) return null
    const displayName = AGENT_DISPLAY_NAMES[agentId] ?? agentId
    return `${displayName} · ${stateText}`
  }

  /** Latest active agent's owning app name (for double-click jump). */
  getMostRecentOwningApp(): string | null {
    let best: AgentEntry | null = null
    for (const entry of this.agents.values()) {
      if (!entry.owningApp) continue
      if (!best || entry.lastActiveAt > best.lastActiveAt) best = entry
    }
    return best?.owningApp ?? null
  }

  private emit(): void {
    const display = this.computeDisplay()
    for (const cb of this.onChangeCallbacks) {
      cb(display)
    }
  }
}
