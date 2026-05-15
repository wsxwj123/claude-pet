import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ConfigStore } from './services/ConfigStore'
import type { PetConfig, ScreenBounds } from '../shared/types'
import { PetLoader } from './services/PetLoader'
import { AgentStateManager } from './services/AgentStateManager'
import { HookServer } from './services/HookServer'
import { injectAllHooks } from './services/HookInjector'
import { ChatContent } from './services/providers/Provider'
import { ProviderRegistry } from './services/providers/ProviderRegistry'
import { ChatStore } from './services/ChatStore'
import { captureScreen, CaptureMode } from './services/ScreenCapture'

app.commandLine.appendSwitch('no-sandbox')

let win: BrowserWindow | null = null
let tray: Tray | null = null
const configStore = new ConfigStore()
const petLoader = new PetLoader()
const agentState = new AgentStateManager()
const hookServer = new HookServer(agentState)
// Pass agentState so providers can push status directly when their
// own plugin hooks are disabled (e.g. opencode `--pure` mode).
const providerRegistry = new ProviderRegistry(agentState)
const chatStore = new ChatStore()
// Active session — created lazily on first send if none exists.
let activeSessionId: string | null = chatStore.mostRecent()?.id ?? null

const SIZE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '迷你', value: 0.3 },
  { label: '小', value: 0.4 },
  { label: '中', value: 0.6 },
  { label: '大', value: 0.85 },
  { label: '超大', value: 1.2 }
]

function getWorkArea(): ScreenBounds {
  // Use the full display bounds (includes menubar / dock regions) so
  // the pet can be dragged flush against any physical screen edge.
  // The alwaysOnTop level handles overlap with the menubar / dock.
  const display = screen.getPrimaryDisplay()
  const b = display.bounds
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/**
 * macOS sometimes shrinks / re-positions the overlay back into the
 * Stage Manager / dock-stripped area when it's hidden and shown again.
 * Call this after every show to force the window back to full-screen
 * physical bounds.
 */
function reassertBounds(): void {
  if (!win) return
  const wa = getWorkArea()
  win.setBounds(wa)
}

function showPet(): void {
  if (!win) return
  win.showInactive()
  reassertBounds()
}

function broadcastConfig(): void {
  win?.webContents.send('config-changed', configStore.get())
}

function showAndPing(kind: string): void {
  if (!win) return
  if (!win.isVisible()) showPet()
  win.webContents.send('tray-action', { kind })
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js')
  const wa = getWorkArea()

  win = new BrowserWindow({
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    movable: false,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.showInactive()
  // After show, Stage Manager / dock occasionally pushes us back into
  // its strip area. Force the bounds again post-show so the window
  // really covers the full display.
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
  // Diagnostic: report the actual on-screen bounds vs requested. macOS
  // sometimes clamps transparent windows into the work area even when
  // we ask for the full display bounds.
  const requested = getWorkArea()
  const actual = win.getBounds()
  console.log(
    `[win] requested ${JSON.stringify(requested)} actual ${JSON.stringify(actual)}`
  )

  agentState.onStateChange((display) => {
    win?.webContents.send('agent-state-update', display)
  })

  screen.on('display-metrics-changed', () => {
    if (!win) return
    win.setBounds(getWorkArea())
  })

  win.on('show', () => {
    console.log('[win] show event')
    updateTrayMenu()
  })
  win.on('hide', () => {
    console.log('[win] hide event — stack:', new Error().stack?.split('\n').slice(1, 5).join(' | '))
    updateTrayMenu()
  })
  win.on('closed', () => console.log('[win] closed event'))
  win.on('blur', () => {
    win?.webContents.send('pet-window-blur')
  })

  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Forward renderer console + load errors into main stdout for tail-able
  // debugging. (DevTools is opt-in via Tray → 打开 DevTools.)
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level === 0 || level === 1) return // skip log/info noise
    console.log(`[renderer ${level}] ${message} (${source}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer load failed] code=${code} desc=${desc} url=${url}`)
  })
}

function buildTrayMenu(): Menu {
  const config = configStore.get()
  const pets = petLoader.loadAll()
  const visible = !!win?.isVisible()

  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏 Pet' : '显示 Pet',
      click: () => {
        if (!win) return
        if (win.isVisible()) win.hide()
        else showPet()
      }
    },
    { type: 'separator' },
    { label: '新对话', click: () => showAndPing('new-chat') },
    { label: '历史会话', click: () => showAndPing('history') },
    { label: '截图分析', click: () => showAndPing('screenshot') },
    { type: 'separator' },
    {
      label: '切换宠物',
      submenu:
        pets.length === 0
          ? [{ label: '未发现 pet', enabled: false }]
          : pets.map((p) => ({
              label: p.displayName,
              type: 'checkbox' as const,
              checked: p.id === config.activePet,
              click: () => {
                configStore.set('activePet', p.id)
                broadcastConfig()
                updateTrayMenu()
              }
            }))
    },
    {
      label: '大小',
      submenu: SIZE_OPTIONS.map((opt) => ({
        label: opt.label,
        type: 'checkbox' as const,
        checked: opt.value === config.petScale,
        click: () => {
          configStore.set('petScale', opt.value)
          broadcastConfig()
          updateTrayMenu()
        }
      }))
    },
    { type: 'separator' },
    { label: '设置', click: () => showAndPing('settings') },
    {
      label: '打开 DevTools',
      click: () => {
        if (!win) return
        win.webContents.openDevTools({ mode: 'detach' })
      }
    },
    { type: 'separator' },
    { label: '退出 claude-pets', click: () => app.quit() }
  ])
}

function updateTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  // Template image: monochrome with alpha, macOS auto-inverts for dark/light menu bar.
  // dev: __dirname is out/main → assets is two levels up. prod: same relative.
  const iconPath = path.join(__dirname, '../../assets/trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('claude-pets')

  tray.on('click', () => {
    if (!win) return
    if (win.isVisible()) win.hide()
    else showPet()
  })

  updateTrayMenu()
}

ipcMain.handle('get-screen-bounds', () => getWorkArea())

ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  if (!win) return
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
  else win.setIgnoreMouseEvents(false)
})

ipcMain.on('hide-window', () => win?.hide())
ipcMain.on('show-window', () => showPet())

// Focus the window so the textarea receives keystrokes. (Previously
// toggled setFocusable; that turned out to nuke the visible window on
// macOS when the panel closed. Window now stays focusable; we only
// nudge focus on demand.)
ipcMain.on('set-window-focusable', (_event, focusable: boolean) => {
  if (!win) return
  if (focusable) win.focus()
})

ipcMain.handle('get-pets', () => petLoader.loadAll())

ipcMain.handle('set-active-pet', (_event, { petId }: { petId: string }) => {
  configStore.set('activePet', petId)
  updateTrayMenu()
  return configStore.get()
})

ipcMain.handle('get-config', () => configStore.get())

ipcMain.handle('set-config', (_event, { key, value }: { key: string; value: unknown }) => {
  configStore.set(key as keyof PetConfig, value)
  if (key === 'petScale' || key === 'activePet') updateTrayMenu()
  if (key === 'shortcuts') applyShortcuts()
  return configStore.get()
})

// Probe: try registering an accelerator briefly to validate it. Returns
// {ok, reason}. Used by the settings UI to give the user immediate
// feedback when they record a key combo that's already taken.
ipcMain.handle('probe-shortcut', (_event, { accelerator }: { accelerator: string }) => {
  if (!accelerator || !accelerator.trim()) return { ok: false, reason: 'empty' }
  // If this accelerator is already one of OUR own registrations, accept
  // it — the user wants to rebind a different action to the same combo,
  // or re-set the same combo on the same action. applyShortcuts() runs
  // unregisterAll() so the conflict resolves on save.
  if (globalShortcut.isRegistered(accelerator)) {
    return { ok: true, reason: 'currently-bound-by-pet' }
  }
  try {
    const ok = globalShortcut.register(accelerator, () => undefined)
    if (ok) {
      globalShortcut.unregister(accelerator)
      return { ok: true }
    }
    return { ok: false, reason: 'taken-by-another-app' }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
})

function getHelperPath(): string {
  // dev: __dirname = .../out/main → project root has bin/
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '..', 'bin', 'claude-pets-hook.js')
  }
  // Production: we cannot just point hook injectors at
  // `process.resourcesPath`, because on Linux AppImage that path is a
  // FUSE mount under /tmp/.mount_<id>/ that changes EVERY launch. The
  // hook command we write into ~/.claude/settings.json would go stale
  // the moment pet exits and the mount unmounts. Copy the helper into
  // a stable user-writable location and return that path instead.
  const src = path.join(process.resourcesPath, 'bin', 'claude-pets-hook.js')
  const stableDir = path.join(os.homedir(), '.claude-pets', 'bin')
  const dst = path.join(stableDir, 'claude-pets-hook.js')
  try {
    fs.mkdirSync(stableDir, { recursive: true })
    // Copy on every launch so an upgraded pet binary refreshes the
    // helper script. Cheap (< 5 KB file).
    fs.copyFileSync(src, dst)
    return dst
  } catch (err) {
    console.warn(
      '[getHelperPath] could not copy helper to stable location, falling back to resourcesPath:',
      err instanceof Error ? err.message : err
    )
    return src
  }
}

ipcMain.handle('reinject-hooks', () => injectAllHooks(getHelperPath()))

// Double-click on pet → activate the macOS app that owns the most
// recently active agent (Claude Desktop / Codex / Terminal / iTerm2 …).
// macOS-only: uses `open -a <AppName>`. Linux/Windows just no-op.
ipcMain.handle('activate-recent-agent', () => {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'app activation only supported on macOS' }
  }
  const appName = agentState.getMostRecentOwningApp()
  if (!appName) return { ok: false, reason: 'no owning app recorded yet' }
  try {
    // Attach .on('error') so an ENOENT (PATH or missing `open`) doesn't
    // become an unhandled exception that crashes main.
    const child = spawn('open', ['-a', appName], { detached: true, stdio: 'ignore' })
    child.on('error', (err) => {
      console.warn('[activate-recent-agent] spawn error:', err.message)
    })
    child.unref()
    return { ok: true, app: appName }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
})

// ── Chat ─────────────────────────────────────────────────────────────
let nextChatTurnId = 1

/**
 * Run a single chat turn through whichever provider this session is
 * bound to. Lazily materializes the session and remembers the provider
 * choice (locked once any messages exist).
 */
function runChatTurn(
  text: string,
  images: Array<{ base64: string; mediaType: string }>,
  preferredProviderId?: string,
  preferredModelId?: string
): { turnId: number; sessionId: string } {
  const turnId = nextChatTurnId++

  if (!activeSessionId) {
    const s = chatStore.createSession(preferredProviderId, preferredModelId)
    activeSessionId = s.id
  }
  const sessionId = activeSessionId
  const session = chatStore.getSession(sessionId)
  const providerId = session?.providerId ?? preferredProviderId ?? providerRegistry.defaultId()
  const modelId = session?.modelId ?? preferredModelId
  const provider = providerRegistry.get(providerId)

  // Persist provider/model choice on first turn so it's locked for the
  // rest of the session.
  if (session && !session.providerId) {
    chatStore.setSessionProvider(sessionId, providerId, modelId)
  }

  const imageTag = images.length > 0 ? `\n[图片 ×${images.length}]` : ''
  chatStore.appendMessage(sessionId, { id: `u-${turnId}`, role: 'user', text: text + imageTag })

  const content: ChatContent[] = []
  if (text) content.push({ type: 'text', text })
  for (const img of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
    })
  }

  win?.webContents.send('chat-event', { turnId, kind: 'start', sessionId })

  // Pass any previously captured native session id so providers that
  // support resume (claude --resume, codex exec resume, opencode
  // --session) keep agent-side context across turns.
  const resumeId = session?.nativeSessionId ?? undefined

  provider.send(
    content,
    { model: modelId, sessionId: resumeId },
    {
      onSessionId: (nativeId) => {
        if (!session?.nativeSessionId) {
          chatStore.setNativeSessionId(sessionId, nativeId)
        }
      },
      onChunk: (delta) =>
        win?.webContents.send('chat-event', { turnId, kind: 'chunk', text: delta }),
      onDone: (finalText) => {
        chatStore.appendMessage(sessionId, { id: `a-${turnId}`, role: 'assistant', text: finalText })
        win?.webContents.send('chat-event', { turnId, kind: 'done', text: finalText })
      },
      onError: (err) => {
        chatStore.appendMessage(sessionId, { id: `e-${turnId}`, role: 'error', text: err })
        win?.webContents.send('chat-event', { turnId, kind: 'error', error: err })
      }
    }
  )

  return { turnId, sessionId }
}

ipcMain.handle(
  'chat-send',
  async (
    _event,
    payload: {
      text: string
      imageBase64?: string
      imageMediaType?: string
      providerId?: string
      modelId?: string
    }
  ) => {
    const images = payload.imageBase64
      ? [{ base64: payload.imageBase64, mediaType: payload.imageMediaType ?? 'image/png' }]
      : []
    return runChatTurn(payload.text, images, payload.providerId, payload.modelId)
  }
)

ipcMain.handle(
  'chat-send-multi',
  async (
    _event,
    payload: {
      text: string
      images: Array<{ base64: string; mediaType: string }>
      providerId?: string
      modelId?: string
    }
  ) => {
    return runChatTurn(payload.text, payload.images, payload.providerId, payload.modelId)
  }
)

ipcMain.handle('chat-list-providers', () => providerRegistry.list())

ipcMain.handle('chat-list-sessions', () => chatStore.listSessions())

ipcMain.handle('chat-get-session', (_e, { sessionId }: { sessionId: string }) =>
  chatStore.getSession(sessionId)
)

ipcMain.handle('chat-new-session', () => {
  // Lazy: don't materialize a row in the store until the user actually
  // sends a message. Otherwise empty "new chat" clicks leave dead rows.
  activeSessionId = null
  return null
})

ipcMain.handle('chat-set-active-session', (_e, { sessionId }: { sessionId: string }) => {
  activeSessionId = sessionId
  return chatStore.getSession(sessionId)
})

ipcMain.handle('chat-delete-session', (_e, { sessionId }: { sessionId: string }) => {
  chatStore.deleteSession(sessionId)
  if (activeSessionId === sessionId) {
    activeSessionId = chatStore.mostRecent()?.id ?? null
  }
  return { activeSessionId }
})

ipcMain.handle('chat-get-active-session-id', () => activeSessionId)

// ── Global shortcuts ────────────────────────────────────────────────
// We re-register on every config change so user edits take effect
// without restart. `globalShortcut.unregisterAll()` clears anything
// previously registered by us — no other code in the app registers
// shortcuts so it's safe.
function tryRegister(label: string, accelerator: string | undefined, fn: () => void): boolean {
  if (!accelerator || !accelerator.trim()) {
    console.log(`[shortcut] ${label}: (empty, skipped)`)
    return false
  }
  try {
    const ok = globalShortcut.register(accelerator, fn)
    console.log(
      `[shortcut] ${label}: ${ok ? '✓' : '✗ register returned false'} (${accelerator})`
    )
    return ok
  } catch (err) {
    console.warn(`[shortcut] ${label}: error for ${accelerator}:`, err)
    return false
  }
}

function applyShortcuts(): void {
  globalShortcut.unregisterAll()
  const cfg = configStore.get()
  const sc = cfg.shortcuts ?? {}
  // toggleChat: bring pet forward + open chat (or close if already open)
  tryRegister('toggleChat', sc.toggleChat, () => {
    console.log('[shortcut] toggleChat fired')
    showAndPing('new-chat')
  })
  // screenshotAnalysis: same as the menu item — new session + region grab + chat
  tryRegister('screenshotAnalysis', sc.screenshotAnalysis, () => {
    console.log('[shortcut] screenshotAnalysis fired')
    showAndPing('screenshot')
  })
  // toggleVisible: pure show/hide
  tryRegister('toggleVisible', sc.toggleVisible, () => {
    console.log('[shortcut] toggleVisible fired')
    if (!win) return
    if (win.isVisible()) win.hide()
    else showPet()
  })
}

// Voice → text via local SenseVoice bridge on :7788. Renderer hands us
// a recorded audio blob (typically MediaRecorder's webm/opus). We:
//   1. write it to a temp file
//   2. transcode to wav with ffmpeg (SenseVoice's soundfile reader
//      doesn't grok webm)
//   3. POST {path: <wav>} to http://127.0.0.1:7788/transcribe_file
//   4. clean up both temp files and return {text}
ipcMain.handle(
  'transcribe-audio',
  async (_e, payload: { base64: string; mimeType?: string }) => {
    const fs = await import('fs')
    const os = await import('os')
    const pathMod = await import('path')
    const { spawn } = await import('child_process')

    const ext = (payload.mimeType ?? 'audio/webm').includes('webm')
      ? 'webm'
      : (payload.mimeType ?? 'audio/wav').split('/')[1] || 'webm'
    const tmpdir = os.tmpdir()
    const stamp = Date.now()
    const inPath = pathMod.join(tmpdir, `claude-pets-voice-${stamp}.${ext}`)
    const wavPath = pathMod.join(tmpdir, `claude-pets-voice-${stamp}.wav`)
    const cleanup = (): void => {
      for (const p of [inPath, wavPath]) {
        try {
          fs.unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    }

    try {
      fs.writeFileSync(inPath, Buffer.from(payload.base64, 'base64'))

      const { spawnPath } = await import('./services/platform')
      await new Promise<void>((resolve, reject) => {
        const ff = spawn(
          'ffmpeg',
          ['-y', '-i', inPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath],
          { env: { ...process.env, PATH: spawnPath() } }
        )
        let stderr = ''
        ff.stderr.on('data', (c) => (stderr += c.toString('utf-8')))
        ff.on('error', (err) => reject(err))
        ff.on('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 300)}`))
        )
      })

      const resp = await fetch('http://127.0.0.1:7788/transcribe_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: wavPath })
      })
      if (!resp.ok) {
        const body = await resp.text()
        return { ok: false, error: `voice-bridge ${resp.status}: ${body.slice(0, 200)}` }
      }
      const data = (await resp.json()) as { text?: string }
      return { ok: true, text: (data.text ?? '').trim() }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    } finally {
      cleanup()
    }
  }
)

// Screenshot capture. We hide the pet window first so the overlay isn't
// in the resulting image, then call macOS's `screencapture` utility,
// then re-show the window. While we're doing this we send capture-start
// / capture-end events so the renderer can suppress its window-blur →
// close-menu reaction; otherwise the menu closes during the screenshot
// and the user comes back to no chat panel.
ipcMain.handle('capture-screen', async (_e, { mode }: { mode: CaptureMode }) => {
  const wasVisible = !!win?.isVisible()
  win?.webContents.send('pet-capture-start')
  // Let the capture-start IPC reach renderer before hide() fires the
  // blur event the renderer needs to suppress.
  await new Promise((r) => setTimeout(r, 60))
  if (wasVisible) win?.hide()
  await new Promise((r) => setTimeout(r, 120))
  try {
    const result = await captureScreen(mode)
    return result
  } finally {
    if (wasVisible) showPet()
    // Slight delay so the blur event from hide() flushes before we
    // re-enable blur handling.
    setTimeout(() => win?.webContents.send('pet-capture-end'), 100)
  }
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  hookServer.start()
  applyShortcuts()

  // Auto-inject hooks. Idempotent: existing claude-pets entries are
  // purged first and re-written, so format upgrades happen automatically.
  const results = injectAllHooks(getHelperPath())
  for (const r of results) {
    console.log(`[HookInjector] ${r.name}: ${r.status}${r.error ? ' (' + r.error + ')' : ''}`)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  hookServer.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
