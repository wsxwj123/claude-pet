// Shared `window.petAPI` type — used by both the renderer (via env.d.ts
// re-export) and the preload's `declare global`. Keep this in sync with
// `contextBridge.exposeInMainWorld('petAPI', ...)` in
// `src/preload/index.ts` — adding a method there but not here will
// cause TS errors at the renderer's call site.

import type {
  PetDescriptor,
  PetConfig,
  DisplayState,
  ScreenBounds,
  UpdateAsset,
  UpdateCheckResult,
  UpdateProgress
} from './types'

export interface PetAPI {
  setIgnoreMouseEvents(ignore: boolean): void
  hideWindow(): void
  showWindow(): void
  setWindowFocusable(focusable: boolean): void
  activateRecentAgent(): Promise<{ ok: boolean; app?: string; reason?: string }>
  captureScreen(mode: 'full' | 'region'): Promise<{
    ok: boolean
    base64?: string
    mediaType?: 'image/png'
    reason?: 'canceled' | 'error' | 'unsupported'
    error?: string
  }>
  getScreenBounds(): Promise<ScreenBounds>
  openExternal(url: string): Promise<{ ok: boolean }>
  checkUpdate(): Promise<UpdateCheckResult>
  downloadAndInstallUpdate(asset: UpdateAsset): Promise<{ ok: boolean; error?: string }>
  onUpdateProgress(callback: (p: UpdateProgress) => void): () => void
  getPets(): Promise<PetDescriptor[]>
  setActivePet(petId: string): Promise<PetConfig>
  getConfig(): Promise<PetConfig>
  setConfig(key: string, value: unknown): Promise<PetConfig>
  onAgentStateUpdate(callback: (display: DisplayState) => void): () => void
  onConfigChanged(callback: (config: PetConfig) => void): () => void
  onWindowBlur(callback: () => void): () => void
  onCaptureStart(callback: () => void): () => void
  onCaptureEnd(callback: () => void): () => void
  onTrayAction(callback: (action: { kind: string }) => void): () => void
  sendChat(payload: {
    text: string
    imageBase64?: string
    imageMediaType?: string
    providerId?: string
    modelId?: string
  }): Promise<{ turnId: number; sessionId: string }>
  sendChatMulti(payload: {
    text: string
    images: Array<{ base64: string; mediaType: string }>
    providerId?: string
    modelId?: string
  }): Promise<{ turnId: number; sessionId: string }>
  listProviders(): Promise<
    Array<{
      id: string
      displayName: string
      configDir: string
      skillsDir: string
      models: string[]
      defaultModel?: string
      available: boolean
    }>
  >
  listChatSessions(): Promise<
    Array<{ id: string; title: string; createdAt: number; updatedAt: number }>
  >
  getChatSession(sessionId: string): Promise<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
    messages: Array<{
      id: string
      role: 'user' | 'assistant' | 'error'
      text: string
      createdAt: number
    }>
  } | null>
  newChatSession(): Promise<null>
  setActiveChatSession(sessionId: string): Promise<unknown>
  deleteChatSession(sessionId: string): Promise<{ activeSessionId: string | null }>
  getActiveChatSessionId(): Promise<string | null>
  transcribeAudio(payload: {
    base64: string
    mimeType?: string
  }): Promise<{ ok: boolean; text?: string; error?: string }>
  probeShortcut(accelerator: string): Promise<{ ok: boolean; reason?: string }>
  onChatEvent(
    callback: (event: {
      turnId: number
      kind: 'start' | 'chunk' | 'done' | 'error'
      text?: string
      error?: string
      sessionId?: string
    }) => void
  ): () => void
}

declare global {
  interface Window {
    petAPI: PetAPI
  }
}
