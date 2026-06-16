import React, { useEffect, useRef, useState } from 'react'
import type { PetDescriptor, UpdateCheckResult } from '../../../shared/types'
import type { ChatMessage, PendingTurn, ProviderDescriptor } from '../App'
import { Icon } from './Icon'
import { toFileUrl } from '../fileUrl'

type View = 'root' | 'pets' | 'size' | 'history' | 'settings' | 'chat' | 'agent' | 'shortcuts'

interface PetAnchor {
  // Pet sprite's bounding rect in window-local (= screen for our full-
  // screen overlay) coordinates.
  petLeft: number
  petTop: number
  petRight: number
  petBottom: number
  viewportWidth: number
  viewportHeight: number
}

interface HoverMenuProps {
  pets: PetDescriptor[]
  activePetId: string
  petScale: number
  chatMessages: ChatMessage[]
  pendingTurn: PendingTurn | null
  chatSessions: Array<{ id: string; title: string; updatedAt: number }>
  activeSessionId: string | null
  attachments: Array<{ base64: string; mediaType: string }>
  providers: ProviderDescriptor[]
  preferredProviderId: string
  preferredModelId: string | undefined
  onSetPreferredProvider: (providerId: string, modelId?: string) => void
  petAnchor: PetAnchor
  openView?: View | null
  onViewChange?: (view: View) => void
  onSendChat: (
    text: string,
    images?: Array<{ base64: string; mediaType: string }>
  ) => void
  onCapture: (mode: 'full' | 'region') => void
  onAddAttachment: (att: { base64: string; mediaType: string }) => void
  onRemoveAttachment: (index: number) => void
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onScreenshot: () => void
  onChangePet: (petId: string) => void
  onReloadPets?: () => void
  onScaleChange: (scale: number) => void
  onSettings: () => void
  onHide: () => void
  chatPinned?: boolean
  onTogglePin?: () => void
}

const SCALE_OPTIONS = [
  { label: '迷你', value: 0.3 },
  { label: '小', value: 0.4 },
  { label: '中', value: 0.6 },
  { label: '大', value: 0.85 },
  { label: '超大', value: 1.2 }
]


// (useAvoidScreenEdges removed — positioning is now precomputed from the
// pet's screen quadrant before render.)

export const HoverMenu: React.FC<HoverMenuProps> = ({
  pets,
  activePetId,
  petScale,
  chatMessages,
  pendingTurn,
  chatSessions,
  activeSessionId,
  attachments,
  providers,
  preferredProviderId,
  preferredModelId,
  onSetPreferredProvider,
  petAnchor,
  openView,
  onViewChange,
  onSendChat,
  onCapture,
  onAddAttachment,
  onRemoveAttachment,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onScreenshot,
  onChangePet,
  onReloadPets,
  onScaleChange,
  onSettings,
  onHide,
  chatPinned,
  onTogglePin
}) => {
  const [view, setViewInternal] = useState<View>('root')
  const setView = (v: View): void => {
    setViewInternal(v)
    onViewChange?.(v)
  }
  useEffect(() => {
    if (openView) setViewInternal(openView)
  }, [openView])

  // Re-scan pet directories whenever the user enters the "切换宠物"
  // submenu. Cheap (readdirSync on 3 folders) and covers the case
  // where the user installed new pets via petdex while pet was running.
  useEffect(() => {
    if (view === 'pets') onReloadPets?.()
  }, [view, onReloadPets])

  // Chat panel size is user-resizable + persisted. Load saved values
  // lazily from PetConfig once on mount; updates are saved after the
  // drag ends to avoid spamming setConfig.
  const [chatSize, setChatSize] = useState<{ width: number; height: number }>({
    width: 360,
    height: 460
  })
  useEffect(() => {
    let cancelled = false
    window.petAPI
      .getConfig()
      .then((cfg) => {
        if (cancelled) return
        const w = cfg.chatPanelWidth ?? 360
        const h = cfg.chatPanelHeight ?? 460
        setChatSize({ width: w, height: h })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Decide menu size + position from the pet's screen quadrant. No
  // measure-and-flip: we pick the side with the most room before render
  // so there's no overflow flash.
  const menuWidth = view === 'chat' ? chatSize.width : 220
  const menuHeight = view === 'chat' ? chatSize.height : 280
  const margin = 12

  const petCenterY = (petAnchor.petTop + petAnchor.petBottom) / 2

  // Side: prefer the half of the screen with more horizontal space.
  const spaceRight = petAnchor.viewportWidth - petAnchor.petRight
  const spaceLeft = petAnchor.petLeft
  const placeRight = spaceRight >= spaceLeft

  let menuLeft: number
  if (placeRight) {
    menuLeft = petAnchor.petRight + margin
    // If even the right side overflows, fall back to centering on pet
    if (menuLeft + menuWidth > petAnchor.viewportWidth - 8) {
      menuLeft = Math.max(8, petAnchor.viewportWidth - menuWidth - 8)
    }
  } else {
    menuLeft = petAnchor.petLeft - menuWidth - margin
    if (menuLeft < 8) {
      menuLeft = 8
    }
  }

  // Vertical: anchor near the pet but keep the menu fully on screen.
  // Prefer aligning the menu's vertical center with the pet's.
  let menuTop = petCenterY - menuHeight / 2
  menuTop = Math.max(8, Math.min(petAnchor.viewportHeight - menuHeight - 8, menuTop))

  // The first-pass `menuHeight` above is just a content-size hint; the
  // root menu in particular is content-driven (height grows with items).
  // If the actual rendered height exceeds the hint, the bottom-right
  // pet position would push the menu below the viewport. Measure the
  // real height after layout and bump menuTop up accordingly.
  const containerRef = useRef<HTMLDivElement>(null)
  const [topAdjust, setTopAdjust] = useState(0)
  useEffect(() => {
    setTopAdjust(0) // reset when view / content changes; layout effect below recomputes
  }, [view])
  // Re-measure only when view / position / viewport changes — not on
  // every render (which would loop with the setState inside).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const h = el.offsetHeight
    const bottom = menuTop + h
    const maxBottom = petAnchor.viewportHeight - 8
    if (bottom > maxBottom) {
      setTopAdjust(-(bottom - maxBottom))
    } else {
      setTopAdjust(0)
    }
  }, [view, menuTop, petAnchor.viewportHeight, menuWidth, menuHeight])
  const finalMenuTop = menuTop + topAdjust

  // Chat input state (local; messages + attachment are owned by parent)
  const [chatInput, setChatInput] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  // Tick once a second while a turn is pending, so the elapsed-time
  // counter in the "thinking" bubble keeps updating without prop drilling.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!pendingTurn) return undefined
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [pendingTurn])
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (view === 'chat') {
      window.petAPI.setWindowFocusable(true)
      chatScrollRef.current?.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth'
      })
      const t = setTimeout(() => chatTextareaRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
    return undefined
  }, [view, chatMessages, pendingTurn?.partialText])

  const sendChat = (): void => {
    const text = chatInput.trim()
    if (pendingTurn) return
    if (!text && attachments.length === 0) return
    onSendChat(text, attachments.length > 0 ? attachments : undefined)
    setChatInput('')
    // attachments cleared by parent after send completes.
  }

  // Voice input state machine: idle ⇄ recording → transcribing → idle.
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      recorderChunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recorderChunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        // Release mic ASAP so the system indicator goes away.
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(recorderChunksRef.current, { type: mime })
        recorderChunksRef.current = []
        if (blob.size === 0) {
          setVoiceStatus('idle')
          return
        }
        setVoiceStatus('transcribing')
        try {
          const buf = await blob.arrayBuffer()
          // Convert ArrayBuffer to base64 without blowing the stack on
          // long recordings.
          const bytes = new Uint8Array(buf)
          let bin = ''
          const chunk = 0x8000
          for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
          }
          const base64 = btoa(bin)
          const r = await window.petAPI.transcribeAudio({ base64, mimeType: mime })
          if (r.ok && r.text) {
            // Append rather than replace so the user can keep typing
            // while transcription is in flight, and so multi-turn voice
            // input accumulates.
            setChatInput((cur) => (cur ? cur + (cur.endsWith(' ') ? '' : ' ') + r.text : r.text!))
            // Refocus the textarea so user can edit or hit Enter.
            setTimeout(() => chatTextareaRef.current?.focus(), 0)
          } else if (r.error) {
            console.error('[voice] transcribe failed:', r.error)
          }
        } catch (err) {
          console.error('[voice] error:', err)
        } finally {
          setVoiceStatus('idle')
        }
      }
      recorderRef.current = rec
      rec.start()
      setVoiceStatus('recording')
    } catch (err) {
      console.error('[voice] getUserMedia failed:', err)
      setVoiceStatus('idle')
    }
  }

  const stopRecording = (): void => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
    recorderRef.current = null
  }

  const toggleVoice = (): void => {
    if (voiceStatus === 'idle') void startRecording()
    else if (voiceStatus === 'recording') stopRecording()
    // 'transcribing' — ignore click, wait for it to finish.
  }

  const handleCapture = (mode: 'full' | 'region'): void => {
    if (captureBusy || pendingTurn) return
    setCaptureBusy(true)
    onCapture(mode)
    setTimeout(() => setCaptureBusy(false), 800)
  }

  // Focus textarea whenever a new attachment lands while on chat view.
  useEffect(() => {
    if (view === 'chat' && attachments.length > 0) {
      chatTextareaRef.current?.focus()
    }
  }, [attachments.length, view])

  // Clipboard paste behavior:
  // - Pure image (screenshot, web image copy without text):
  //   attach as image
  // - Word / Excel / browser rich-content (text + auto-generated
  //   preview image): prefer the TEXT, let textarea's default paste
  //   handle it. Otherwise pasting from Word always lost the text.
  // - Cmd+Shift+V on macOS / Ctrl+Shift+V on Win = plain text paste
  //   from the OS — works automatically as long as we don't
  //   preventDefault when text is present.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const cd = e.clipboardData
    if (!cd) return
    const text = cd.getData('text/plain')
    // If meaningful text is on the clipboard, let the textarea paste
    // it natively — don't hijack with the image branch.
    if (text && text.length > 0) return
    const items = cd.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // strip data URL header → just base64
        const idx = result.indexOf(',')
        if (idx < 0) return
        const base64 = result.slice(idx + 1)
        onAddAttachment({ base64, mediaType: file.type })
      }
      reader.readAsDataURL(file)
    }
  }

  const fmtTime = (ts: number): string => {
    const d = new Date(ts)
    const today = new Date()
    if (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const menuItem = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    active?: boolean,
    trailing?: React.ReactNode
  ): React.ReactElement => (
    <button
      className={`flex items-center gap-2.5 w-full px-2.5 py-2 text-[13px] text-left rounded-lg transition-colors ${
        active
          ? 'bg-slate-900/[.06] text-slate-900'
          : 'text-slate-700 hover:bg-slate-900/[.04]'
      }`}
      onClick={onClick}
    >
      <span
        className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${
          active ? 'text-slate-900' : 'text-slate-500'
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && (
        <span className="text-slate-400 ml-1 flex items-center">{trailing}</span>
      )}
    </button>
  )

  const backHeader = (title: string): React.ReactElement => (
    <button
      className="flex items-center gap-2 w-full px-2 py-2 text-[13px] text-left text-slate-500 hover:bg-slate-900/[.04] rounded-lg transition-colors"
      onClick={() => setView('root')}
    >
      <span className="w-4 h-4 flex items-center justify-center">
        <Icon name="chevron-left" />
      </span>
      <span className="font-medium text-slate-700">{title}</span>
    </button>
  )

  const todoNote = (text: string): React.ReactElement => (
    <div className="px-3 py-2 text-xs text-gray-400 leading-relaxed">{text}</div>
  )

  const renderRoot = (): React.ReactElement => {
    const chev = <Icon name="chevron-right" size={12} />
    return (
      <>
        {menuItem(<Icon name="chat" />, '新对话', () => {
          onNewSession()
          setView('chat')
        })}
        {menuItem(<Icon name="history" />, '历史会话', () => setView('history'), false, chev)}
        {menuItem(<Icon name="camera" />, '截图分析', onScreenshot)}

        <div className="my-1.5 border-t border-slate-200/60" />

        {menuItem(<Icon name="cpu" />, '模型选择', () => setView('agent'), false, chev)}
        {menuItem(<Icon name="paw" />, '切换宠物', () => setView('pets'), false, chev)}
        {menuItem(<Icon name="maximize" />, '大小', () => setView('size'), false, chev)}

        <div className="my-1.5 border-t border-slate-200/60" />

        {menuItem(<Icon name="settings" />, '设置', () => setView('settings'), false, chev)}
        {menuItem(<Icon name="eye-off" />, '隐藏', onHide)}
      </>
    )
  }

  const renderAgent = (): React.ReactElement => {
    const activeProv = providers.find((p) => p.id === preferredProviderId)
    return (
      <>
        {backHeader('模型选择')}
        <div className="my-1.5 border-t border-slate-200/60" />
        <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-medium">
          框架
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
          {providers.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">未发现可用框架</div>
          ) : (
            providers.map((p) => (
              <button
                key={p.id}
                disabled={!p.available}
                className={`flex items-center gap-2.5 w-full px-2.5 py-2 text-[13px] text-left rounded-lg transition-colors ${
                  p.id === preferredProviderId
                    ? 'bg-slate-900/[.06] text-slate-900'
                    : p.available
                    ? 'text-slate-700 hover:bg-slate-900/[.04]'
                    : 'text-slate-400'
                }`}
                onClick={() => {
                  if (!p.available) return
                  onSetPreferredProvider(p.id, p.defaultModel)
                }}
                title={p.configDir}
              >
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                  {p.id === preferredProviderId ? (
                    <Icon name="check" />
                  ) : (
                    <Icon name="circle" size={10} className="text-slate-300" />
                  )}
                </span>
                <span className="flex-1 truncate">
                  {p.displayName}
                  {!p.available && (
                    <span className="text-[11px] text-slate-400 ml-1">未安装</span>
                  )}
                </span>
                <span
                  className="text-[10px] text-slate-400 truncate flex-shrink-0"
                  style={{ maxWidth: 90 }}
                >
                  {p.configDir.replace(/^.*[\\/]/, '…/')}
                </span>
              </button>
            ))
          )}
        </div>
        {activeProv && activeProv.models.length > 0 && (
          <>
            <div className="my-1.5 border-t border-slate-200/60" />
            <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-medium">
              模型
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {activeProv.models.map((m) => (
                <button
                  key={m}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-2 text-[13px] text-left rounded-lg transition-colors ${
                    m === preferredModelId
                      ? 'bg-slate-900/[.06] text-slate-900'
                      : 'text-slate-700 hover:bg-slate-900/[.04]'
                  }`}
                  onClick={() => onSetPreferredProvider(preferredProviderId, m)}
                >
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {m === preferredModelId && <Icon name="check" />}
                  </span>
                  <span className="flex-1 truncate font-mono text-[12px]">{m}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="my-1.5 border-t border-slate-200/60" />
        <div className="px-2.5 py-1.5 text-[11px] text-slate-500 leading-relaxed">
          切换框架自动开新对话，并切到该框架的全局配置目录。
        </div>
      </>
    )
  }

  const renderPets = (): React.ReactElement => (
    <>
      {backHeader('切换宠物')}
      <div className="my-1.5 border-t border-slate-200/60" />
      <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
        {pets.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400">未发现 pet</div>
        ) : (
          // Pets get their own row layout (not menuItem) because the
          // sprite thumbnail is 24×26 — bigger than the 16×16 icon slot
          // that other menu rows use. Sprite is the visual anchor here.
          pets.map((pet) => {
            const active = pet.id === activePetId
            return (
              <button
                key={pet.id}
                onClick={() => {
                  onChangePet(pet.id)
                  setView('root')
                }}
                className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg transition-colors ${
                  active
                    ? 'bg-slate-900/[.06] text-slate-900'
                    : 'text-slate-700 hover:bg-slate-900/[.04]'
                }`}
              >
                <span className="w-6 h-7 flex items-center justify-center flex-shrink-0">
                  <PetThumb spritesheetAbsPath={pet.spritesheetAbsPath} />
                </span>
                <span className="flex-1 truncate">{pet.displayName}</span>
                {active && (
                  <span className="text-slate-500">
                    <Icon name="check" size={12} />
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
      <div className="my-1.5 border-t border-slate-200/60" />
      {menuItem(<Icon name="store" />, '宠物市场', () => {
        void window.petAPI.openExternal('https://petdex.dev/zh')
      })}
      {onReloadPets && (
        <>
          <div className="my-1.5 border-t border-slate-200/60" />
          {menuItem(<Icon name="refresh" />, '重新扫描', () => onReloadPets())}
          <div className="px-2.5 pb-1 text-[10px] text-slate-400 leading-relaxed">
            ~/.codex/pets · ~/.petdex/pets · ~/.claude/pets
          </div>
        </>
      )}
    </>
  )

  const renderSize = (): React.ReactElement => (
    <>
      {backHeader('大小')}
      <div className="my-1.5 border-t border-slate-200/60" />
      {SCALE_OPTIONS.map((opt) => (
        <React.Fragment key={opt.value}>
          {menuItem(
            opt.value === petScale ? <Icon name="check" /> : <span className="w-4 h-4" />,
            opt.label,
            () => {
              onScaleChange(opt.value)
              setView('root')
            },
            opt.value === petScale
          )}
        </React.Fragment>
      ))}
    </>
  )

  const renderHistory = (): React.ReactElement => (
    <>
      {backHeader('历史会话')}
      <div className="my-1.5 border-t border-slate-200/60" />
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {chatSessions.length === 0 ? (
          todoNote('暂无历史会话。\n点击下方按钮开始新对话。')
        ) : (
          chatSessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                className={`flex items-center gap-2.5 flex-1 px-2.5 py-2 text-[13px] text-left rounded-lg transition-colors ${
                  s.id === activeSessionId
                    ? 'bg-slate-900/[.06] text-slate-900'
                    : 'text-slate-700 hover:bg-slate-900/[.04]'
                }`}
                onClick={() => {
                  onSwitchSession(s.id)
                  setView('chat')
                }}
                style={{ minWidth: 0 }}
              >
                <span
                  className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${
                    s.id === activeSessionId ? 'text-slate-900' : 'text-slate-500'
                  }`}
                >
                  <Icon name="chat" />
                </span>
                <span className="flex-1 truncate" style={{ minWidth: 0 }}>
                  {s.title}
                </span>
                <span className="text-[10px] text-slate-400 flex-shrink-0 ml-1">
                  {fmtTime(s.updatedAt)}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm('删除此会话？')) onDeleteSession(s.id)
                }}
                className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-slate-900/[.04] transition-colors"
                title="删除"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="my-1.5 border-t border-slate-200/60" />
      {menuItem(<Icon name="plus" />, '开始新对话', () => {
        onNewSession()
        setView('chat')
      })}
    </>
  )

  // Provider/model picker is shown only on the chat view, and only
  // before the user has sent the first message — once a session has
  // history, switching providers would corrupt context.
  const isNewSession = chatMessages.length === 0 && !pendingTurn
  const currentProvider = providers.find((p) => p.id === preferredProviderId) ?? providers[0]
  const renderProviderPicker = (): React.ReactElement | null => {
    if (!isNewSession || providers.length === 0) return null
    return (
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12
        }}
      >
        <span style={{ color: '#6b7280' }}>Agent:</span>
        <select
          value={preferredProviderId}
          onChange={(e) => {
            const next = providers.find((p) => p.id === e.target.value)
            onSetPreferredProvider(e.target.value, next?.defaultModel)
          }}
          style={{
            fontSize: 12,
            padding: '2px 4px',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 6,
            background: '#fff'
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.displayName}
              {!p.available ? ' (未安装)' : ''}
            </option>
          ))}
        </select>
        {currentProvider?.models && currentProvider.models.length > 0 && (
          <>
            <span style={{ color: '#6b7280', marginLeft: 4 }}>Model:</span>
            <select
              value={preferredModelId ?? ''}
              onChange={(e) =>
                onSetPreferredProvider(preferredProviderId, e.target.value || undefined)
              }
              style={{
                fontSize: 12,
                padding: '2px 4px',
                border: '1px solid rgba(0,0,0,0.1)',
                borderRadius: 6,
                background: '#fff',
                minWidth: 0
              }}
            >
              <option value="">(默认)</option>
              {currentProvider.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    )
  }

  const renderChat = (): React.ReactElement => (
    <div style={{ display: 'flex', flexDirection: 'column', height: menuHeight - 12 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>{backHeader('对话')}</div>
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            title={chatPinned ? '已置顶（点这里取消）' : '点击置顶对话框'}
            className={`mr-1 p-1.5 rounded-md transition-all ${
              chatPinned
                ? 'text-slate-900 hover:bg-slate-900/[.04]'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-900/[.04]'
            }`}
            style={{
              transform: chatPinned ? 'rotate(0deg)' : 'rotate(45deg)',
              transition: 'transform 180ms ease-out, color 120ms'
            }}
          >
            <Icon name="pin" size={14} strokeWidth={chatPinned ? 2.2 : 1.75} />
          </button>
        )}
      </div>
      {renderProviderPicker()}
      <div className="border-t border-gray-100" />
      <div
        ref={chatScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          userSelect: 'text',
          WebkitUserSelect: 'text'
        }}
      >
        {chatMessages.length === 0 && !pendingTurn && (
          <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', marginTop: 60 }}>
            说点什么开始对话
          </div>
        )}
        {chatMessages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.text} />
        ))}
        {pendingTurn && (() => {
          const elapsedSec = Math.max(0, Math.floor((Date.now() - pendingTurn.startedAt) / 1000))
          const slow = elapsedSec >= 30
          const fallback =
            elapsedSec < 30
              ? `对方正在输入… (${elapsedSec}s)`
              : `对方正在输入… (${elapsedSec}s · 响应慢，可能在加载大 skill 或网络不通）`
          return (
            <Bubble
              role="assistant"
              text={pendingTurn.partialText || fallback}
              pending={!pendingTurn.partialText}
              slow={slow && !pendingTurn.partialText}
            />
          )
        })()}
      </div>
      <div
        style={{
          padding: '8px 10px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        {attachments.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '4px 0'
            }}
          >
            {attachments.map((att, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  display: 'inline-block'
                }}
              >
                <img
                  src={`data:${att.mediaType};base64,${att.base64}`}
                  alt={`图片 ${i + 1}`}
                  style={{
                    width: 56,
                    height: 42,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: '1px solid rgba(0,0,0,0.12)'
                  }}
                />
                <button
                  onClick={() => onRemoveAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-slate-900/80 text-white flex items-center justify-center hover:bg-slate-900 transition-colors"
                  title="移除"
                >
                  <Icon name="x" size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={toggleVoice}
            disabled={voiceStatus === 'transcribing' || !!pendingTurn}
            title={
              voiceStatus === 'idle'
                ? '语音输入（点击开始）'
                : voiceStatus === 'recording'
                ? '录音中…点击结束并转写'
                : '识别中…'
            }
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              voiceStatus === 'recording'
                ? 'border border-red-300 bg-red-50 text-red-600'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            } ${
              voiceStatus === 'transcribing' || pendingTurn
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer'
            }`}
          >
            {voiceStatus === 'transcribing' ? (
              <Icon name="mic-loading" size={15} className="animate-spin" />
            ) : voiceStatus === 'recording' ? (
              <Icon name="mic-recording" size={9} />
            ) : (
              <Icon name="mic" size={15} />
            )}
          </button>
          <button
            onClick={() => handleCapture('region')}
            disabled={captureBusy || !!pendingTurn}
            title="拖拽选区截图（ESC 取消）"
            className={`flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors ${
              captureBusy || pendingTurn ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <Icon name="scissors" size={15} />
          </button>
          <button
            onClick={() => handleCapture('full')}
            disabled={captureBusy || !!pendingTurn}
            title="全屏截图"
            className={`flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors ${
              captureBusy || pendingTurn ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <Icon name="monitor" size={15} />
          </button>
          <textarea
            ref={chatTextareaRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendChat()
              }
            }}
            placeholder={
              pendingTurn
                ? '对方正在输入…'
                : attachments.length > 0
                ? '想问的问题（可留空）'
                : '回车发送，Shift+回车换行，Cmd+V 粘贴图片'
            }
            rows={2}
            className="flex-1 resize-none border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] bg-white text-slate-800 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 outline-none font-[inherit]"
          />
          <button
            onClick={sendChat}
            disabled={!!pendingTurn || (!chatInput.trim() && attachments.length === 0)}
            className={`px-3.5 rounded-lg text-[13px] font-medium transition-colors ${
              pendingTurn || (!chatInput.trim() && attachments.length === 0)
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'
            }`}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )

  // Shortcuts settings sub-view state. Lazy-load on first open.
  const [shortcuts, setShortcuts] = useState<{
    toggleChat: string
    screenshotAnalysis: string
    toggleVisible: string
  }>({
    toggleChat: '',
    screenshotAnalysis: '',
    toggleVisible: ''
  })
  const [recordingFor, setRecordingFor] = useState<keyof typeof shortcuts | null>(null)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  useEffect(() => {
    if (view !== 'shortcuts') return
    window.petAPI.getConfig().then((cfg) => {
      const sc = cfg.shortcuts ?? {}
      setShortcuts({
        toggleChat: sc.toggleChat ?? '',
        screenshotAnalysis: sc.screenshotAnalysis ?? '',
        toggleVisible: sc.toggleVisible ?? ''
      })
    })
  }, [view])

  // Translate a KeyboardEvent into an Electron Accelerator string
  // (e.g. "Cmd+Shift+C"). Returns null if the user pressed only
  // modifiers — wait for a real key.
  const eventToAccelerator = (e: KeyboardEvent): string | null => {
    const mods: string[] = []
    if (e.metaKey) mods.push('Cmd')
    if (e.ctrlKey) mods.push('Ctrl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    const k = e.key
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null
    // Some combos (especially Option/Alt on macOS) yield "Dead" because
    // the OS treats them as IME composition keys. Use e.code as a
    // fallback so the user still gets a meaningful accelerator.
    const isDead = k === 'Dead' || k === 'Unidentified' || k === ''
    let key = k
    if (isDead) {
      // e.code like "KeyC" / "Digit1" / "Space" → strip prefix
      const code = e.code
      if (code.startsWith('Key')) key = code.slice(3)
      else if (code.startsWith('Digit')) key = code.slice(5)
      else if (code === 'Space') key = 'Space'
      else key = code
    } else if (k.length === 1) {
      key = k.toUpperCase()
    } else {
      const map: Record<string, string> = {
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
        ' ': 'Space',
        Escape: 'Esc'
      }
      key = map[k] ?? k
    }
    if (!key || mods.length === 0) return null // require a modifier
    return [...mods, key].join('+')
  }

  // Listen for keydown while recording.
  useEffect(() => {
    if (!recordingFor) return
    // The pet window is transparent + click-through except over
    // interactive areas. document.keydown only fires when the window
    // itself has focus — force focus so the user's key press is
    // actually captured by us, not by whatever app is in the foreground.
    window.petAPI.setWindowFocusable(true)
    const handler = async (e: KeyboardEvent): Promise<void> => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingFor(null)
        setProbeMsg(null)
        return
      }
      const acc = eventToAccelerator(e)
      if (!acc) return
      const r = await window.petAPI.probeShortcut(acc)
      if (!r.ok) {
        setProbeMsg(`"${acc}" 不可用（${r.reason ?? '失败'}）`)
        return
      }
      const next = { ...shortcuts, [recordingFor]: acc }
      setShortcuts(next)
      // Persist
      await window.petAPI.setConfig('shortcuts', next)
      setProbeMsg(null)
      setRecordingFor(null)
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [recordingFor, shortcuts])

  const renderShortcuts = (): React.ReactElement => {
    const SHORTCUT_LABELS: Array<{ key: keyof typeof shortcuts; label: string }> = [
      { key: 'toggleChat', label: '切换对话框' },
      { key: 'screenshotAnalysis', label: '截图分析' },
      { key: 'toggleVisible', label: '显示/隐藏 pet' }
    ]
    return (
      <>
        {backHeader('快捷键')}
        <div className="my-1 border-t border-gray-100" />
        {SHORTCUT_LABELS.map(({ key, label }) => {
          const isRecording = recordingFor === key
          const value = shortcuts[key] || '未设置'
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                fontSize: 13
              }}
            >
              <span style={{ flex: 1, color: '#374151' }}>{label}</span>
              <button
                onClick={() => {
                  setProbeMsg(null)
                  setRecordingFor(isRecording ? null : key)
                }}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.1)',
                  background: isRecording ? '#fef3c7' : '#fff',
                  color: isRecording ? '#92400e' : '#1f2937',
                  cursor: 'pointer',
                  minWidth: 110,
                  textAlign: 'center'
                }}
              >
                {isRecording ? '按下新组合…' : value}
              </button>
              {shortcuts[key] && !isRecording && (
                <button
                  onClick={async () => {
                    const next = { ...shortcuts, [key]: '' }
                    setShortcuts(next)
                    await window.petAPI.setConfig('shortcuts', next)
                  }}
                  title="清除"
                  className="text-slate-400 hover:text-red-500 p-1 rounded transition-colors"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          )
        })}
        {probeMsg && (
          <div style={{ padding: '4px 12px', fontSize: 11, color: '#b91c1c' }}>
            {probeMsg}
          </div>
        )}
        <div className="my-1 border-t border-gray-100" />
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
          点击当前组合 → 按下新组合录入。Esc 取消。 修饰键支持 Cmd/Ctrl/Alt/Shift，至少 1 个。
        </div>
      </>
    )
  }

  const [showAbout, setShowAbout] = useState(false)
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'downloading' | 'done'>(
    'idle'
  )
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const renderSettings = (): React.ReactElement => {
    const u = updateResult
    const handleCheck = async (): Promise<void> => {
      if (updatePhase === 'checking' || updatePhase === 'downloading') return
      setUpdatePhase('checking')
      try {
        const res = await window.petAPI.checkUpdate()
        setUpdateResult(res)
        setUpdatePhase('done')
      } catch {
        setUpdateResult({ ok: false, currentVersion: '', releasesPage: '', error: '检查失败' })
        setUpdatePhase('done')
      }
    }
    const handleInstall = async (): Promise<void> => {
      if (!u?.asset) return
      setUpdatePhase('downloading')
      setUpdateProgress(0)
      const off = window.petAPI.onUpdateProgress((p) => setUpdateProgress(p.percent))
      try {
        const res = await window.petAPI.downloadAndInstallUpdate(u.asset)
        // On success the app quits and relaunches — we only get here on failure.
        if (!res.ok) {
          setUpdateResult({ ...u, error: res.error })
          setUpdatePhase('done')
        }
      } catch {
        setUpdateResult({ ...u, error: '安装失败' })
        setUpdatePhase('done')
      } finally {
        off()
      }
    }
    return (
      <>
        {backHeader('设置')}
        <div className="my-1.5 border-t border-slate-200/60" />
        {menuItem(<Icon name="keyboard" />, '快捷键', () => setView('shortcuts'), false,
          <Icon name="chevron-right" size={12} />)}
        {menuItem(<Icon name="plug" />, 'Hook 状态', () => {
          onSettings()
        }, false, <span className="font-mono text-[10px] text-slate-400">:7779</span>)}
        <div className="my-1.5 border-t border-slate-200/60" />
        {menuItem(
          <Icon name="refresh" />,
          updatePhase === 'checking' ? '检查中…' : '检查更新',
          () => void handleCheck(),
          false,
          updatePhase === 'downloading' ? (
            <span className="font-mono text-[10px] text-slate-400">{updateProgress}%</span>
          ) : undefined
        )}
        {updatePhase === 'done' && u && (
          <div className="mx-2 mt-1 mb-1 px-3 py-2.5 rounded-lg bg-slate-900/[.04] text-[11px] text-slate-600 leading-relaxed space-y-1.5">
            {u.error ? (
              <div className="text-rose-600">更新出错：{u.error}</div>
            ) : u.hasUpdate ? (
              <>
                <div className="text-slate-800">
                  发现新版本 <span className="font-medium">v{u.latestVersion}</span>
                  <span className="text-slate-400">（当前 v{u.currentVersion}）</span>
                </div>
                {u.noAsset ? (
                  <button
                    className="w-full px-2 py-1.5 rounded-md bg-slate-900/[.06] hover:bg-slate-900/[.1] text-slate-700 transition-colors"
                    onClick={() => void window.petAPI.openExternal(u.releasesPage)}
                  >
                    无当前平台安装包，前往下载页
                  </button>
                ) : (
                  <button
                    className="w-full px-2 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60"
                    disabled={updatePhase !== 'done'}
                    onClick={() => void handleInstall()}
                  >
                    下载并安装（重启生效）
                  </button>
                )}
              </>
            ) : (
              <div>已是最新版本 v{u.currentVersion}</div>
            )}
          </div>
        )}
        {updatePhase === 'downloading' && (
          <div className="mx-2 mt-1 mb-1 px-3 py-2.5 rounded-lg bg-slate-900/[.04] text-[11px] text-slate-600">
            <div className="mb-1.5">正在下载并安装… {updateProgress}%</div>
            <div className="h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-[width] duration-200"
                style={{ width: `${updateProgress}%` }}
              />
            </div>
          </div>
        )}
        {menuItem(<Icon name="info" />, '关于 claude-pets', () => setShowAbout((v) => !v))}
        {showAbout && (
          <div className="mx-2 mt-1 mb-1 px-3 py-2.5 rounded-lg bg-slate-900/[.04] text-[11px] text-slate-600 leading-relaxed space-y-1">
            <div className="font-medium text-slate-800 text-[12px]">claude-pets</div>
            <div>统一 agent 框架壳：Claude Code / opencode / 自定义</div>
            <div className="flex items-center gap-1 text-slate-500">
              <span>Hook server:</span>
              <span className="font-mono">127.0.0.1:7779</span>
            </div>
            <div className="flex items-center gap-1 text-slate-500">
              <span>配置:</span>
              <span className="font-mono">~/.claude-pets/</span>
            </div>
            <div className="pt-1 text-slate-400">
              MIT · github.com/wsxwj123/claude-pets
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: menuLeft,
        top: finalMenuTop,
        width: menuWidth,
        maxHeight: petAnchor.viewportHeight - 16,
        overflowY: 'auto',
        zIndex: 100,
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.6) inset, 0 12px 40px -8px rgba(15, 23, 42, 0.18), 0 4px 12px -4px rgba(15, 23, 42, 0.08)',
        borderRadius: '14px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        color: '#1e293b'
      }}
    >
      <div className="p-2">
        {view === 'root' && renderRoot()}
        {view === 'pets' && renderPets()}
        {view === 'size' && renderSize()}
        {view === 'history' && renderHistory()}
        {view === 'settings' && renderSettings()}
        {view === 'chat' && renderChat()}
        {view === 'agent' && renderAgent()}
        {view === 'shortcuts' && renderShortcuts()}
      </div>
      {view === 'chat' && (
        <>
          {(['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'] as ResizeDir[]).map((dir) => (
            <ResizeHandle
              key={dir}
              dir={dir}
              onResize={(dw, dh) =>
                setChatSize((prev) => ({
                  width: Math.max(280, Math.min(700, prev.width + dw)),
                  height: Math.max(320, Math.min(800, prev.height + dh))
                }))
              }
              onResizeEnd={(finalW, finalH) => {
                void window.petAPI.setConfig('chatPanelWidth', finalW)
                void window.petAPI.setConfig('chatPanelHeight', finalH)
              }}
              chatSize={chatSize}
            />
          ))}
        </>
      )}
    </div>
  )
}

type ResizeDir = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'

const HANDLE_STYLES: Record<ResizeDir, React.CSSProperties> = {
  n:  { top: -3, left: 12, right: 12, height: 8, cursor: 'ns-resize' },
  s:  { bottom: -3, left: 12, right: 12, height: 8, cursor: 'ns-resize' },
  w:  { left: -3, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' },
  e:  { right: -3, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' },
  nw: { top: -3, left: -3, width: 14, height: 14, cursor: 'nwse-resize' },
  ne: { top: -3, right: -3, width: 14, height: 14, cursor: 'nesw-resize' },
  sw: { bottom: -3, left: -3, width: 14, height: 14, cursor: 'nesw-resize' },
  se: { bottom: -3, right: -3, width: 14, height: 14, cursor: 'nwse-resize' }
}

// Map a per-frame pointer delta (dx, dy in screen px) to a panel size
// delta (dw, dh), based on which edge/corner is being dragged. Because
// the chat panel re-centers on the pet each render, dragging the *top*
// edge upward should INCREASE height (the bottom stays put by the
// centering math), not move the panel. Same for left edge.
function deltaForDir(dir: ResizeDir, dx: number, dy: number): { dw: number; dh: number } {
  let dw = 0
  let dh = 0
  if (dir.includes('e')) dw += dx
  if (dir.includes('w')) dw += -dx
  if (dir.includes('s')) dh += dy
  if (dir.includes('n')) dh += -dy
  return { dw, dh }
}

const ResizeHandle: React.FC<{
  dir: ResizeDir
  onResize: (dw: number, dh: number) => void
  onResizeEnd: (w: number, h: number) => void
  chatSize: { width: number; height: number }
}> = ({ dir, onResize, onResizeEnd, chatSize }) => {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const lastDxRef = useRef(0)
  const lastDyRef = useRef(0)

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    startRef.current = { x: e.screenX, y: e.screenY }
    lastDxRef.current = 0
    lastDyRef.current = 0
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!startRef.current) return
    const dx = e.screenX - startRef.current.x
    const dy = e.screenY - startRef.current.y
    const frameDx = dx - lastDxRef.current
    const frameDy = dy - lastDyRef.current
    lastDxRef.current = dx
    lastDyRef.current = dy
    const { dw, dh } = deltaForDir(dir, frameDx, frameDy)
    if (dw !== 0 || dh !== 0) onResize(dw, dh)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (!startRef.current) return
    onResizeEnd(chatSize.width, chatSize.height)
    startRef.current = null
    lastDxRef.current = 0
    lastDyRef.current = 0
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  // SE corner gets a small visible grip (macOS-style), the rest stay
  // invisible — the cursor change on hover is enough hint.
  const isSE = dir === 'se'
  return (
    <div
      data-interactive=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        ...HANDLE_STYLES[dir],
        zIndex: 5,
        background: isSE
          ? 'linear-gradient(135deg, transparent 0 50%, rgba(0,0,0,0.25) 50% 56%, transparent 56% 70%, rgba(0,0,0,0.25) 70% 76%, transparent 76% 100%)'
          : 'transparent',
        borderBottomRightRadius: isSE ? 12 : undefined
      }}
    />
  )
}

// 24×26 thumbnail showing the idle/frame-0 cell of a pet's spritesheet.
// All sprites in this project share the same 1536×1872 / 8 cols × 9 rows
// / 192×208-per-cell layout (see usePetAnimation.ts), so we can hardcode
// the math instead of reading per-pet metadata.
const PetThumb: React.FC<{ spritesheetAbsPath: string }> = ({ spritesheetAbsPath }) => {
  const SHEET_W = 1536
  const SHEET_H = 1872
  const FRAME_W = 192
  const FRAME_H = 208
  const THUMB_W = 24
  const THUMB_H = 26
  const scaleX = THUMB_W / FRAME_W
  const scaleY = THUMB_H / FRAME_H
  return (
    <span
      style={{
        display: 'inline-block',
        width: THUMB_W,
        height: THUMB_H,
        backgroundImage: `url("${toFileUrl(spritesheetAbsPath)}")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: '0 0',
        backgroundSize: `${SHEET_W * scaleX}px ${SHEET_H * scaleY}px`,
        imageRendering: 'pixelated'
      }}
    />
  )
}

// Minimal inline-markdown renderer for assistant chat bubbles.
// Handles: **bold**, *italic* / _italic_, `code`, [text](url), and
// auto-links bare http(s) URLs. Returns an array of React nodes.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Tokenize in priority order: code, bold, italic-underscore, italic-star,
  // explicit link, bare URL. Each match captures the original substring so
  // we can splice around it. The underscore-italic arm is guarded by
  // non-word lookbehind/lookahead so snake_case identifiers (my_var_name)
  // are NOT mangled into italics.
  const pattern =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(?<!\w)(_[^_\n]+_)(?!\w)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (m[1]) {
      nodes.push(
        <code
          key={k}
          style={{
            background: 'rgba(0,0,0,0.06)',
            padding: '1px 5px',
            borderRadius: 4,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '0.92em'
          }}
        >
          {tok.slice(1, -1)}
        </code>
      )
    } else if (m[2]) {
      nodes.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    } else if (m[3]) {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>)
    } else if (m[4]) {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>)
    } else if (m[5]) {
      const close = tok.indexOf(']')
      const label = tok.slice(1, close)
      const url = tok.slice(close + 2, -1)
      nodes.push(
        <a
          key={k}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            void window.petAPI.openExternal(url)
          }}
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          {label}
        </a>
      )
    } else if (m[6]) {
      // Bare URL — strip trailing sentence punctuation ("see https://x.com.")
      // so the period/comma/paren isn't swallowed into the link. The
      // stripped tail is re-emitted as plain text.
      let url = tok
      let trail = ''
      const tm = url.match(/[.,!?;:)\]'"]+$/)
      if (tm) {
        trail = tm[0]
        url = url.slice(0, url.length - trail.length)
      }
      const bareUrl = url
      nodes.push(
        <a
          key={k}
          href={bareUrl}
          onClick={(e) => {
            e.preventDefault()
            void window.petAPI.openExternal(bareUrl)
          }}
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          {bareUrl}
        </a>
      )
      if (trail) nodes.push(trail)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// Block-level markdown renderer. Walks the text line-by-line and emits:
// fenced code blocks, ATX headings (# ##), unordered/ordered lists, and
// paragraphs whose inline content goes through renderInline.
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0

  const codeBlockStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.06)',
    padding: '8px 10px',
    borderRadius: 6,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '0.9em',
    overflowX: 'auto',
    whiteSpace: 'pre',
    margin: '4px 0'
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing fence
      out.push(
        <pre key={`c-${key++}`} style={codeBlockStyle}>
          <code>{buf.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const sizes = ['1.15em', '1.08em', '1em', '0.95em']
      out.push(
        <div
          key={`h-${key++}`}
          style={{
            fontSize: sizes[level - 1],
            fontWeight: 700,
            margin: '6px 0 2px',
            lineHeight: 1.3
          }}
        >
          {renderInline(h[2], `h${key}`)}
        </div>
      )
      i++
      continue
    }

    // Lists (group consecutive list lines)
    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/)
    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ulMatch || olMatch) {
      const ordered = !!olMatch
      const items: string[] = []
      while (i < lines.length) {
        const u = lines[i].match(/^\s*[-*]\s+(.*)$/)
        const o = lines[i].match(/^\s*\d+\.\s+(.*)$/)
        if (ordered && o) items.push(o[1])
        else if (!ordered && u) items.push(u[1])
        else break
        i++
      }
      const ListTag = ordered ? 'ol' : 'ul'
      out.push(
        <ListTag
          key={`l-${key++}`}
          style={{
            margin: '4px 0',
            paddingLeft: 20,
            listStyleType: ordered ? 'decimal' : 'disc'
          }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: '1px 0' }}>
              {renderInline(it, `li-${key}-${idx}`)}
            </li>
          ))}
        </ListTag>
      )
      continue
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      // Avoid trailing whitespace collapse — emit a small spacer only if
      // the previous element was not already a block separator.
      out.push(<div key={`b-${key++}`} style={{ height: 4 }} />)
      i++
      continue
    }

    // Default: paragraph line. Join consecutive plain lines with <br/>.
    const paraLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    out.push(
      <div key={`p-${key++}`} style={{ margin: '2px 0' }}>
        {paraLines.flatMap((l, idx) => {
          const nodes = renderInline(l, `p${key}-${idx}`)
          return idx === 0 ? nodes : [<br key={`br-${idx}`} />, ...nodes]
        })}
      </div>
    )
  }
  return out
}

const Bubble: React.FC<{
  role: ChatMessage['role']
  text: string
  pending?: boolean
  slow?: boolean
}> = ({ role, text, pending, slow }) => {
  // Only render markdown for assistant messages. User messages stay plain
  // text so users see exactly what they sent. Error messages stay plain
  // too — they're already short and we don't want stack-trace asterisks
  // turning into italics.
  const renderMd = role === 'assistant' && !pending
  return (
    <div
      style={{
        alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        padding: '7px 11px',
        borderRadius: 12,
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: renderMd ? 'normal' : 'pre-wrap',
        wordBreak: 'break-word',
        background:
          role === 'user'
            ? '#3b82f6'
            : role === 'error'
            ? '#fef2f2'
            : slow
            ? '#fef3c7'
            : '#f3f4f6',
        color:
          role === 'user'
            ? '#fff'
            : role === 'error'
            ? '#b91c1c'
            : slow
            ? '#92400e'
            : '#1f2937',
        fontStyle: pending ? 'italic' : undefined,
        opacity: pending ? 0.7 : 1,
        userSelect: 'text',
        WebkitUserSelect: 'text',
        cursor: 'text'
      }}
    >
      {renderMd ? renderMarkdown(text) : text}
    </div>
  )
}
