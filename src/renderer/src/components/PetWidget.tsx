import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePetAnimation, AnimState } from '../hooks/usePetAnimation'
import { useDrag } from '../hooks/useDrag'
import { useMousePassthrough } from '../hooks/useMousePassthrough'
import { HoverMenu } from './HoverMenu'
import { StatusLabel } from './StatusLabel'
import type { PetDescriptor, ScreenBounds } from '../../../shared/types'
import type { ChatMessage, PendingTurn, ReplyPreview, ProviderDescriptor } from '../App'

const BASE_WIDTH = 192
const BASE_HEIGHT = 208
// Pet may overhang the screen far enough that only this many pixels
// remain visible — guarantees the user can always grab it back, while
// allowing the visible pet pixels to sit flush against any edge even
// when the sprite cell has substantial transparent padding.
const MIN_VISIBLE_PX = 24

interface PetWidgetProps {
  spritesheetUrl: string | null
  agentAnimState: AnimState
  statusLabel: string | null
  pets: PetDescriptor[]
  activePetId: string
  petScale: number
  initialPosition: { x: number; y: number }
  screenBounds: ScreenBounds
  chatMessages: ChatMessage[]
  pendingTurn: PendingTurn | null
  replyPreview: ReplyPreview | null
  chatSessions: Array<{ id: string; title: string; updatedAt: number }>
  activeSessionId: string | null
  chatAttachments: Array<{ base64: string; mediaType: string }>
  onChangePet: (petId: string) => void
  onReloadPets?: () => void
  onScaleChange: (scale: number) => void
  onPositionChange: (pos: { x: number; y: number }) => void
  onSendChat: (
    text: string,
    images?: Array<{ base64: string; mediaType: string }>
  ) => void
  onClearReplyPreview: () => void
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onCaptureScreen: (mode: 'full' | 'region') => void
  onAddAttachment: (att: { base64: string; mediaType: string }) => void
  onRemoveAttachment: (index: number) => void
  onClearAttachments: () => void
  providers: ProviderDescriptor[]
  preferredProviderId: string
  preferredModelId: string | undefined
  onSetPreferredProvider: (providerId: string, modelId?: string) => void
}

export const PetWidget: React.FC<PetWidgetProps> = ({
  spritesheetUrl,
  agentAnimState,
  statusLabel,
  pets,
  activePetId,
  petScale,
  initialPosition,
  screenBounds,
  chatMessages,
  pendingTurn,
  replyPreview,
  chatSessions,
  activeSessionId,
  chatAttachments,
  onChangePet,
  onReloadPets,
  onScaleChange,
  onPositionChange,
  onSendChat,
  onClearReplyPreview,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onCaptureScreen,
  onAddAttachment,
  onRemoveAttachment,
  onClearAttachments,
  providers,
  preferredProviderId,
  preferredModelId,
  onSetPreferredProvider
}) => {
  const [dragOverrideState, setDragOverrideState] = useState<AnimState | null>(null)
  const [menuVisible, setMenuVisible] = useState(false)
  type View = 'root' | 'pets' | 'size' | 'history' | 'settings' | 'chat' | 'agent' | 'shortcuts'
  const [menuView, setMenuView] = useState<View>('root')
  const [pendingOpenView, setPendingOpenView] = useState<View | null>(null)
  // Pin: when true, chat panel won't auto-close on outside click /
  // window blur. Useful when copy-pasting from other apps. Session-only.
  const [chatPinned, setChatPinned] = useState(false)

  useEffect(() => {
    const cleanup = window.petAPI.onTrayAction((action) => {
      if (action.kind === 'new-chat') {
        onNewSession()
        setMenuVisible(true)
        setPendingOpenView('chat')
      } else if (action.kind === 'history') {
        setMenuVisible(true)
        setPendingOpenView('history')
      } else if (action.kind === 'settings') {
        setMenuVisible(true)
        setPendingOpenView('settings')
      } else if (action.kind === 'screenshot') {
        // Was silently dropped before — Tray/global-shortcut
        // "screenshot" action did nothing. handleScreenshot is the
        // same flow root menu uses (new session + region capture).
        handleScreenshot()
      }
    })
    return cleanup
    // handleScreenshot is defined below using useCallback so it's
    // stable across renders; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNewSession])

  useEffect(() => {
    if (pendingOpenView) {
      const t = setTimeout(() => setPendingOpenView(null), 100)
      return () => clearTimeout(t)
    }
    return undefined
  }, [pendingOpenView])

  const petWidth = Math.round(BASE_WIDTH * petScale)
  const petHeight = Math.round(BASE_HEIGHT * petScale)

  // Pet position in window-local coords. Since the window covers the work
  // area starting at screenBounds.{x,y}, window-local (px, py) corresponds
  // to screen position (screenBounds.x + px, screenBounds.y + py).
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: initialPosition.x - screenBounds.x,
    y: initialPosition.y - screenBounds.y
  }))
  const posRef = useRef(pos)
  posRef.current = pos

  const clampPos = useCallback(
    (px: number, py: number): { x: number; y: number } => {
      const minX = -(petWidth - MIN_VISIBLE_PX)
      const minY = -(petHeight - MIN_VISIBLE_PX)
      const maxX = screenBounds.width - MIN_VISIBLE_PX
      const maxY = screenBounds.height - MIN_VISIBLE_PX
      return {
        x: Math.max(minX, Math.min(maxX, px)),
        y: Math.max(minY, Math.min(maxY, py))
      }
    },
    [screenBounds.width, screenBounds.height, petWidth, petHeight]
  )

  // Re-clamp when window/screen size or pet scale changes
  useEffect(() => {
    setPos((p) => clampPos(p.x, p.y))
  }, [clampPos])

  const handleMove = useCallback(
    (dx: number, dy: number) => {
      setPos((p) => clampPos(p.x + dx, p.y + dy))
    },
    [clampPos]
  )

  // Persist position (debounced via posRef snapshot)
  useEffect(() => {
    const t = setTimeout(() => {
      onPositionChange({
        x: pos.x + screenBounds.x,
        y: pos.y + screenBounds.y
      })
    }, 200)
    return () => clearTimeout(t)
  }, [pos.x, pos.y, screenBounds.x, screenBounds.y, onPositionChange])

  // Detect which screen edge (if any) the pet is currently flush against.
  // Currently only used to log/expose a hint — we don't yet have edge-
  // specific sprite rows. When such a sprite asset is added later, the
  // animation row index for these states can be wired here.
  // D2 edge-pose detection — wired but unused until edge-cling sprite
  // rows exist. When sprite assets land, use this to pick the right
  // AnimState (clinging-left / -right / -top / -bottom).
  //
  // const edgeProximity = ((): 'left' | 'right' | 'top' | 'bottom' | null => {
  //   const slack = 8
  //   if (pos.x <= -(petWidth - MIN_VISIBLE_PX) + slack) return 'left'
  //   if (pos.x >= screenBounds.width - petWidth - slack) return 'right'
  //   if (pos.y <= -(petHeight - MIN_VISIBLE_PX) + slack) return 'top'
  //   if (pos.y >= screenBounds.height - petHeight - slack) return 'bottom'
  //   return null
  // })()

  const effectiveState: AnimState = dragOverrideState ?? agentAnimState
  const spriteStyle = usePetAnimation(effectiveState)

  const handleDragStateChange = useCallback((state: AnimState | null) => {
    setDragOverrideState(state)
  }, [])

  const activateRecentAgent = useCallback(() => {
    window.petAPI.activateRecentAgent().catch(() => {
      // ignore — best effort
    })
  }, [])

  // Click pet:
  //   - if a turn is pending OR a reply preview is showing → open chat
  //     view inside the menu
  //   - otherwise toggle the hover menu as before
  const handlePetClick = useCallback(() => {
    if (!menuVisible && (pendingTurn || replyPreview)) {
      if (replyPreview) onClearReplyPreview()
      setMenuVisible(true)
      setPendingOpenView('chat')
      return
    }
    setMenuVisible((v) => !v)
  }, [menuVisible, pendingTurn, replyPreview, onClearReplyPreview])

  const { onPointerDown, isDragging } = useDrag({
    onStateChange: handleDragStateChange,
    onMove: handleMove,
    onClick: handlePetClick,
    onDoubleClick: activateRecentAgent
  })

  useMousePassthrough(isDragging)

  // Dismiss menu when:
  //   1. user clicks an empty (transparent → passthrough) area inside
  //      the pet window — fires as a pointerdown without the
  //      [data-interactive] target since the rest of the overlay is
  //      transparent and event-passthrough; or
  //   2. user clicks another app (e.g. Bob), causing the pet window to
  //      lose focus — detected via the window 'blur' event forwarded
  //      from main as a custom DOM event.
  useEffect(() => {
    if (!menuVisible) return
    const handler = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && target.closest('[data-interactive]')) return
      // Pin freezes the chat panel open for copy-paste workflows.
      if (chatPinned && menuView === 'chat') return
      setMenuVisible(false)
    }
    window.addEventListener('pointerdown', handler, true)
    return () => {
      window.removeEventListener('pointerdown', handler, true)
    }
  }, [menuVisible, chatPinned, menuView])

  // Also dismiss when the pet window itself loses focus (user clicks
  // another always-on-top app). Main forwards win.on('blur') as
  // 'pet-window-blur' on webContents.
  //
  // BUT: a screenshot temporarily hides the pet window, which fires a
  // blur event. We listen for capture-start / capture-end and use the
  // captureGuard ref to suppress the blur handler during that window.
  const captureGuard = useRef(false)
  useEffect(() => {
    const off1 = window.petAPI.onCaptureStart(() => {
      captureGuard.current = true
    })
    const off2 = window.petAPI.onCaptureEnd(() => {
      captureGuard.current = false
    })
    return () => {
      off1()
      off2()
    }
  }, [])

  useEffect(() => {
    if (!menuVisible) return
    const cleanup = window.petAPI.onWindowBlur(() => {
      if (captureGuard.current) return
      if (chatPinned && menuView === 'chat') return
      setMenuVisible(false)
    })
    return cleanup
  }, [menuVisible, chatPinned, menuView])

  // "截图分析" 一级菜单：开启一个新会话 + 触发局部截图，截好后进入
  // chat view 显示「图 + 文本输入框」。这是"专门来分析这张截图"的
  // 入口，所以独立 session 而不是接在历史里。
  const handleScreenshot = (): void => {
    onClearAttachments()
    onNewSession()
    onCaptureScreen('region')
    setPendingOpenView('chat')
  }
  const handleSettings = (): void => {
    // stays in menu (renders the settings view)
  }
  const handleHide = (): void => {
    setMenuVisible(false)
    window.petAPI.hideWindow()
  }

  // Tick once a second while a turn is pending so the elapsed counter
  // in the pet's status bubble keeps updating.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!pendingTurn) return undefined
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [pendingTurn])

  // Status label priority:
  //   1. Chat panel NOT open + main's agent state if it's actively
  //      doing work (running a tool, thinking, etc) → that's more
  //      informative than the generic "typing…" placeholder
  //   2. Chat panel NOT open + pending turn (no tool activity) →
  //      "对方正在输入… (Xs)" with elapsed counter
  //   3. Chat panel NOT open + recent reply preview → snippet
  //   4. Otherwise → main's agent state (may be null = no label)
  const chatPanelOpen = menuVisible && menuView === 'chat'
  const effectiveStatusLabel = ((): string | null => {
    // statusLabel from main is non-null only when an agent is actively
    // doing something (running tool / thinking / waving). Prefer it
    // over the generic typing placeholder when we have it.
    if (!chatPanelOpen && statusLabel) return statusLabel
    if (!chatPanelOpen && pendingTurn) {
      const elapsed = Math.max(0, Math.floor((Date.now() - pendingTurn.startedAt) / 1000))
      return elapsed < 30
        ? `对方正在输入… (${elapsed}s)`
        : `响应慢 (${elapsed}s)·skill/网络可能阻塞`
    }
    if (!chatPanelOpen && replyPreview) {
      const snippet = replyPreview.text.replace(/\s+/g, ' ').slice(0, 28)
      return `Claude · ${snippet}${replyPreview.text.length > 28 ? '…' : ''}`
    }
    return statusLabel
  })()

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {effectiveStatusLabel ? (
        <StatusLabelFixed
          text={effectiveStatusLabel}
          petCenterX={pos.x + petWidth / 2}
          petY={pos.y}
          petHeight={petHeight}
          viewportWidth={screenBounds.width}
        />
      ) : null}
      <div
        data-interactive
        style={{
          position: 'absolute',
          left: pos.x,
          top: pos.y,
          width: petWidth,
          height: petHeight,
          touchAction: 'none',
          pointerEvents: 'auto'
        }}
        onPointerDown={onPointerDown}
      >
      {/* Pet sprite fills the wrapper directly so the pet can be flush
          against any screen edge. Status label is rendered as a separate
          fixed element below. */}
        {spritesheetUrl ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'url("' + spritesheetUrl + '")',
              backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated',
              cursor: 'grab',
              ...spriteStyle
            }}
          ></div>
        ) : (
          // Fallback before any pet sprite is loaded (rare — only on
          // first launch with no pet installed). Neutral pulsing dot,
          // not an emoji.
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'grab'
            }}
          >
            <div
              className="animate-pulse"
              style={{
                width: Math.round(petHeight * 0.35),
                height: Math.round(petHeight * 0.35),
                borderRadius: '50%',
                background: 'rgba(148, 163, 184, 0.4)'
              }}
            />
          </div>
        )}

      {/* Menu — positioned relative to this wrapper, HoverMenu picks anchor */}
      {menuVisible && (
        <div
          data-interactive
          onPointerDown={(e) => e.stopPropagation()}
        >
          <HoverMenu
            pets={pets}
            activePetId={activePetId}
            petScale={petScale}
            chatMessages={chatMessages}
            pendingTurn={pendingTurn}
            chatSessions={chatSessions}
            activeSessionId={activeSessionId}
            attachments={chatAttachments}
            providers={providers}
            preferredProviderId={preferredProviderId}
            preferredModelId={preferredModelId}
            onSetPreferredProvider={onSetPreferredProvider}
            onCapture={onCaptureScreen}
            onAddAttachment={onAddAttachment}
            onRemoveAttachment={onRemoveAttachment}
            petAnchor={{
              petLeft: pos.x,
              petTop: pos.y,
              petRight: pos.x + petWidth,
              petBottom: pos.y + petHeight,
              viewportWidth: screenBounds.width,
              viewportHeight: screenBounds.height
            }}
            openView={pendingOpenView}
            onViewChange={setMenuView}
            onSendChat={onSendChat}
            onNewSession={onNewSession}
            onSwitchSession={onSwitchSession}
            onDeleteSession={onDeleteSession}
            onScreenshot={handleScreenshot}
            onChangePet={onChangePet}
            onReloadPets={onReloadPets}
            onScaleChange={onScaleChange}
            onSettings={handleSettings}
            onHide={handleHide}
            chatPinned={chatPinned}
            onTogglePin={() => setChatPinned((p) => !p)}
          />
        </div>
      )}
      </div>
    </div>
  )
}

/**
 * Fixed-position status label that measures its rendered width and
 * clamps horizontal placement so it never overflows the screen edges.
 */
const StatusLabelFixed: React.FC<{
  text: string
  petCenterX: number
  petY: number
  petHeight: number
  viewportWidth: number
}> = ({ text, petCenterX, petY, petHeight, viewportWidth }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(120)
  // Bubble height grows with line count (multi-agent stack). Measure
  // it so we can push the top further up and avoid covering the pet.
  const [height, setHeight] = useState(24)

  useEffect(() => {
    if (ref.current) {
      const w = ref.current.offsetWidth
      const h = ref.current.offsetHeight
      if (w > 0 && w !== width) setWidth(w)
      if (h > 0 && h !== height) setHeight(h)
    }
  }, [text])

  const desiredLeft = petCenterX - width / 2
  const clampedLeft = Math.max(8, Math.min(viewportWidth - width - 8, desiredLeft))
  // Sit the bubble fully above the pet (with 4px gap). If there's no
  // room at the top, drop it below instead.
  const top = petY < height + 8 ? petY + petHeight + 4 : petY - height - 4

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: clampedLeft,
        top,
        pointerEvents: 'none',
        zIndex: 90,
        width: 'max-content'
      }}
    >
      <StatusLabel text={text} />
    </div>
  )
}
