// Shared type definitions used by main, preload, and renderer

export interface PetDescriptor {
  id: string
  displayName: string
  description: string
  spritesheetAbsPath: string
}

export interface PetConfig {
  activePet: string
  petScale: number
  // Pet's screen position (where the sprite's top-left sits on screen).
  position: { x: number; y: number }
  // Default provider/model used for the NEXT new session. Each provider
  // ships its own configDir (~/.claude, ~/.config/opencode, ...) so
  // switching here automatically swaps which agent framework's global
  // config gets used.
  preferredProviderId?: string
  preferredModelId?: string
  // Chat panel size. Persisted so the user's preferred size survives
  // restarts.
  chatPanelWidth?: number
  chatPanelHeight?: number
  /**
   * Global shortcut bindings. Values use Electron Accelerator syntax
   * (e.g. "Cmd+Shift+C"). Empty string disables that shortcut.
   */
  shortcuts?: {
    toggleChat?: string
    screenshotAnalysis?: string
    toggleVisible?: string
  }
}

export interface ScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

export type AnimState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface DisplayState {
  animState: AnimState
  labelText: string | null
}

export type HookKind = 'pre' | 'post' | 'user' | 'stop' | 'notif'

export interface UpdateAsset {
  name: string
  url: string
  size: number
}

export interface UpdateCheckResult {
  ok: boolean
  currentVersion: string
  latestVersion?: string
  hasUpdate?: boolean
  asset?: UpdateAsset
  noAsset?: boolean
  releasesPage: string
  error?: string
}

export interface UpdateProgress {
  receivedBytes: number
  totalBytes: number
  percent: number
}
