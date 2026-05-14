/**
 * Agent provider interface — the seam that lets claude-pets call any
 * CLI agent (Claude Code, opencode, openclaude, …) through a single
 * stream-event abstraction.
 *
 * Built-in providers live as classes in this directory; third-party
 * providers can be declared via JSON at ~/.claude-pets/providers/*.json
 * (see ProviderRegistry).
 */

export interface ChatContent {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

export interface ChatTurnCallbacks {
  /**
   * Provider-native session id (Claude: init.session_id, opencode:
   * step_start.sessionID, …). Persisted by caller so subsequent turns
   * can resume context without rebuilding it.
   */
  onSessionId?: (sessionId: string) => void
  onChunk?: (text: string) => void
  onDone?: (finalText: string) => void
  onError?: (err: string) => void
}

export interface SendOptions {
  /** Model id to use for this turn (must be in `models` if specified). */
  model?: string
  /** Resume-on-disk session id for context continuation (provider-specific). */
  sessionId?: string
  /** Workspace / cwd for the spawned process. Defaults to user home. */
  cwd?: string
}

/**
 * Static descriptor used by the renderer to populate the picker UI.
 * Does not include actual CLI invocation logic — that's in send().
 */
export interface ProviderInfo {
  id: string
  displayName: string
  /** Where this agent stores its skills / settings / api keys. */
  configDir: string
  /** Defaults to configDir + '/skills'. */
  skillsDir: string
  /** Available models for the model picker. Optional. */
  models: string[]
  /** Default model when none is specified. */
  defaultModel?: string
  /** Whether `binary` is on PATH (lazy-checked at app start). */
  available: boolean
}

export interface Provider {
  readonly info: ProviderInfo

  /**
   * Send a single user turn. Each call spawns a fresh subprocess
   * (provider may reuse caches via session id if supported). Emits
   * chunk/done/error via callbacks. Promise resolves with the final
   * assistant text.
   */
  send(content: ChatContent[], options: SendOptions, callbacks: ChatTurnCallbacks): Promise<string>
}
