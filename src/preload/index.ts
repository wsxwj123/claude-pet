import { contextBridge, ipcRenderer } from 'electron'
import type {
  PetDescriptor,
  PetConfig,
  DisplayState,
  ScreenBounds,
  UpdateAsset,
  UpdateCheckResult,
  UpdateProgress
} from '../shared/types'

contextBridge.exposeInMainWorld('petAPI', {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },

  hideWindow: (): void => ipcRenderer.send('hide-window'),
  showWindow: (): void => ipcRenderer.send('show-window'),
  setWindowFocusable: (focusable: boolean): void =>
    ipcRenderer.send('set-window-focusable', focusable),

  getScreenBounds: (): Promise<ScreenBounds> => ipcRenderer.invoke('get-screen-bounds'),

  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('open-external', { url }),

  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('check-update'),

  downloadAndInstallUpdate: (asset: UpdateAsset): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('download-and-install-update', { asset }),

  onUpdateProgress: (callback: (p: UpdateProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, p: UpdateProgress): void => callback(p)
    ipcRenderer.on('update-progress', handler)
    return () => ipcRenderer.removeListener('update-progress', handler)
  },

  getPets: (): Promise<PetDescriptor[]> => ipcRenderer.invoke('get-pets'),

  setActivePet: (petId: string): Promise<PetConfig> => {
    return ipcRenderer.invoke('set-active-pet', { petId })
  },

  getConfig: (): Promise<PetConfig> => ipcRenderer.invoke('get-config'),

  setConfig: (key: string, value: unknown): Promise<PetConfig> => {
    return ipcRenderer.invoke('set-config', { key, value })
  },

  onAgentStateUpdate: (callback: (display: DisplayState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, display: DisplayState): void => {
      callback(display)
    }
    ipcRenderer.on('agent-state-update', handler)
    return () => {
      ipcRenderer.removeListener('agent-state-update', handler)
    }
  },

  onConfigChanged: (callback: (config: PetConfig) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, config: PetConfig): void => {
      callback(config)
    }
    ipcRenderer.on('config-changed', handler)
    return () => {
      ipcRenderer.removeListener('config-changed', handler)
    }
  },

  onWindowBlur: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('pet-window-blur', handler)
    return () => ipcRenderer.removeListener('pet-window-blur', handler)
  },

  onCaptureStart: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('pet-capture-start', handler)
    return () => ipcRenderer.removeListener('pet-capture-start', handler)
  },

  onCaptureEnd: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('pet-capture-end', handler)
    return () => ipcRenderer.removeListener('pet-capture-end', handler)
  },

  onTrayAction: (callback: (action: { kind: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: { kind: string }): void => {
      callback(action)
    }
    ipcRenderer.on('tray-action', handler)
    return () => {
      ipcRenderer.removeListener('tray-action', handler)
    }
  },

  activateRecentAgent: (): Promise<{ ok: boolean; app?: string; reason?: string }> =>
    ipcRenderer.invoke('activate-recent-agent'),

  captureScreen: (
    mode: 'full' | 'region'
  ): Promise<{
    ok: boolean
    base64?: string
    mediaType?: 'image/png'
    reason?: 'canceled' | 'error' | 'unsupported'
    error?: string
  }> => ipcRenderer.invoke('capture-screen', { mode }),

  sendChat: (payload: {
    text: string
    imageBase64?: string
    imageMediaType?: string
    providerId?: string
    modelId?: string
  }): Promise<{ turnId: number; sessionId: string }> =>
    ipcRenderer.invoke('chat-send', payload),

  sendChatMulti: (payload: {
    text: string
    images: Array<{ base64: string; mediaType: string }>
    providerId?: string
    modelId?: string
  }): Promise<{ turnId: number; sessionId: string }> =>
    ipcRenderer.invoke('chat-send-multi', payload),

  listProviders: (): Promise<
    Array<{
      id: string
      displayName: string
      configDir: string
      skillsDir: string
      models: string[]
      defaultModel?: string
      available: boolean
    }>
  > => ipcRenderer.invoke('chat-list-providers'),

  listChatSessions: (): Promise<
    Array<{ id: string; title: string; createdAt: number; updatedAt: number }>
  > => ipcRenderer.invoke('chat-list-sessions'),

  getChatSession: (sessionId: string): Promise<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
    messages: Array<{ id: string; role: 'user' | 'assistant' | 'error'; text: string; createdAt: number }>
  } | null> => ipcRenderer.invoke('chat-get-session', { sessionId }),

  newChatSession: (): Promise<null> => ipcRenderer.invoke('chat-new-session'),

  setActiveChatSession: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke('chat-set-active-session', { sessionId }),

  deleteChatSession: (sessionId: string): Promise<{ activeSessionId: string | null }> =>
    ipcRenderer.invoke('chat-delete-session', { sessionId }),

  getActiveChatSessionId: (): Promise<string | null> =>
    ipcRenderer.invoke('chat-get-active-session-id'),

  transcribeAudio: (payload: {
    base64: string
    mimeType?: string
  }): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('transcribe-audio', payload),

  probeShortcut: (accelerator: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('probe-shortcut', { accelerator }),

  onChatEvent: (
    callback: (event: {
      turnId: number
      kind: 'start' | 'chunk' | 'done' | 'error'
      text?: string
      error?: string
      sessionId?: string
    }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ev: Parameters<typeof callback>[0]): void => {
      callback(ev)
    }
    ipcRenderer.on('chat-event', handler)
    return () => {
      ipcRenderer.removeListener('chat-event', handler)
    }
  }
})

// The global Window.petAPI type lives in `src/shared/petAPI.d.ts`
// and is referenced by both preload and renderer tsconfigs.
/// <reference path="../shared/petAPI.d.ts" />
