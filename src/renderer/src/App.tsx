import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PetWidget } from './components/PetWidget'
import type { AnimState } from './hooks/usePetAnimation'
import type { PetDescriptor, ScreenBounds } from '../../shared/types'
import { toFileUrl } from './fileUrl'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
}

export interface PendingTurn {
  turnId: number
  partialText: string
  startedAt: number
  /** Which chat session this turn belongs to (needed for session
   *  switching — we don't clear pendingTurn when switching back to
   *  the same in-flight session). */
  sessionId?: string
}

export interface ReplyPreview {
  text: string
  completedAt: number
}

export interface ProviderDescriptor {
  id: string
  displayName: string
  configDir: string
  skillsDir: string
  models: string[]
  defaultModel?: string
  available: boolean
}

interface AppState {
  pets: PetDescriptor[]
  activePetId: string
  petScale: number
  spritesheetUrl: string | null
  agentAnimState: AnimState
  statusLabel: string | null
  initialPosition: { x: number; y: number } | null
  screenBounds: ScreenBounds | null
  chatMessages: ChatMessage[]
  pendingTurn: PendingTurn | null
  replyPreview: ReplyPreview | null
  chatSessions: Array<{ id: string; title: string; updatedAt: number }>
  activeSessionId: string | null
  chatAttachments: Array<{ base64: string; mediaType: string }>
  providers: ProviderDescriptor[]
  /** Provider chosen for the NEXT new session (locked once messages start). */
  preferredProviderId: string
  preferredModelId: string | undefined
}

const PREVIEW_TTL_MS = 12_000

export default function App(): React.ReactElement {
  const [state, setState] = useState<AppState>({
    pets: [],
    activePetId: '',
    petScale: 0.4,
    spritesheetUrl: null,
    agentAnimState: 'idle',
    statusLabel: null,
    initialPosition: null,
    screenBounds: null,
    chatMessages: [],
    pendingTurn: null,
    replyPreview: null,
    chatSessions: [],
    activeSessionId: null,
    chatAttachments: [],
    providers: [],
    preferredProviderId: 'claude-cli',
    preferredModelId: undefined
  })

  const cleanupRef = useRef<(() => void) | null>(null)
  // Latest state mirror so async callbacks (handleSendChat etc.) read
  // the current preferred provider / session, not the stale closure
  // they were created with. useCallback's empty-deps form would
  // otherwise capture the initial state forever.
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [config, pets, screenBounds, sessions, activeId, providers] = await Promise.all([
          window.petAPI.getConfig(),
          window.petAPI.getPets(),
          window.petAPI.getScreenBounds(),
          window.petAPI.listChatSessions(),
          window.petAPI.getActiveChatSessionId(),
          window.petAPI.listProviders()
        ])
        const activePet = pets.find((p) => p.id === config.activePet) ?? pets[0] ?? null
        const spritesheetUrl = activePet ? toFileUrl(activePet.spritesheetAbsPath) : null

        let chatMessages: ChatMessage[] = []
        let activeSessionId: string | null = activeId
        if (activeSessionId) {
          const session = await window.petAPI.getChatSession(activeSessionId)
          if (session) {
            chatMessages = session.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.text
            }))
          } else {
            activeSessionId = null
          }
        }

        // Prefer the user's saved choice; fall back to first available
        // provider, then to claude-cli.
        const savedPid = config.preferredProviderId
        const savedMid = config.preferredModelId
        const resolvedPid =
          (savedPid && providers.find((p) => p.id === savedPid)?.id) ??
          providers[0]?.id ??
          'claude-cli'
        const resolvedMid =
          savedMid ?? providers.find((p) => p.id === resolvedPid)?.defaultModel

        setState((prev) => ({
          ...prev,
          pets,
          activePetId: activePet?.id ?? config.activePet,
          petScale: config.petScale,
          spritesheetUrl,
          initialPosition: config.position,
          screenBounds,
          chatMessages,
          chatSessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt
          })),
          activeSessionId,
          providers,
          preferredProviderId: resolvedPid,
          preferredModelId: resolvedMid
        }))
      } catch (err) {
        console.error('[App] init error:', err)
      }
    }
    init()

    const cleanupAgent = window.petAPI.onAgentStateUpdate((display) => {
      setState((prev) => ({
        ...prev,
        agentAnimState: display.animState as AnimState,
        statusLabel: display.labelText
      }))
    })
    const cleanupConfig = window.petAPI.onConfigChanged((config) => {
      setState((prev) => {
        const pet = prev.pets.find((p) => p.id === config.activePet) ?? null
        return {
          ...prev,
          petScale: config.petScale,
          activePetId: config.activePet,
          spritesheetUrl: pet ? toFileUrl(pet.spritesheetAbsPath) : prev.spritesheetUrl
        }
      })
    })

    // Stream chat events into global state so the chat panel can be
    // closed and re-opened without losing in-flight turns or history.
    //
    // Multi-session correctness: a chat-event always carries the
    // session it belongs to. If the user has switched away to a
    // different session while a turn is mid-flight, we MUST NOT
    // mutate the displayed chatMessages array (it belongs to the new
    // session). Main's ChatStore persists the reply to the correct
    // session regardless — when the user switches back, getChatSession
    // returns the up-to-date history.
    const cleanupChat = window.petAPI.onChatEvent((event) => {
      // Always refresh sessions list on terminal events, regardless
      // of which session — the title preview / sort order changes.
      if (event.kind === 'done' || event.kind === 'error') {
        window.petAPI
          .listChatSessions()
          .then((sessions) =>
            setState((p) => ({
              ...p,
              chatSessions: sessions.map((s) => ({
                id: s.id,
                title: s.title,
                updatedAt: s.updatedAt
              }))
            }))
          )
          .catch(() => undefined)
      }
      setState((prev) => {
        if (event.kind === 'start') {
          // Lazy-session sync: if activeSessionId is null (user just
          // clicked 新对话 and hasn't picked one yet) bind it to the
          // newly-created session id. Otherwise leave alone — don't
          // hijack the user back from whatever they're viewing.
          const nextActive =
            prev.activeSessionId == null && event.sessionId
              ? event.sessionId
              : prev.activeSessionId
          // Only set pendingTurn (the "thinking" bubble) if this
          // event belongs to the session the user is currently
          // viewing. Background turns don't get a visible bubble.
          if (event.sessionId && event.sessionId !== nextActive) {
            // Background turn — still tag pendingTurn with its
            // session so a later switch-back can recover it.
            return {
              ...prev,
              activeSessionId: nextActive,
              pendingTurn: {
                turnId: event.turnId,
                partialText: '',
                startedAt: Date.now(),
                sessionId: event.sessionId
              }
            }
          }
          return {
            ...prev,
            activeSessionId: nextActive,
            pendingTurn: {
              turnId: event.turnId,
              partialText: '',
              startedAt: Date.now(),
              sessionId: event.sessionId ?? nextActive ?? undefined
            }
          }
        }
        // For chunk / done / error: only mutate visible state when
        // BOTH the turnId matches our tracked pendingTurn (guards
        // against stale events after switch+overwrite) AND the
        // event's sessionId is what's currently displayed.
        const isForCurrentView =
          event.sessionId == null || event.sessionId === prev.activeSessionId
        const matchesPending =
          prev.pendingTurn && prev.pendingTurn.turnId === event.turnId

        if (event.kind === 'chunk') {
          if (!matchesPending || !isForCurrentView) return prev
          return {
            ...prev,
            pendingTurn: {
              ...prev.pendingTurn!,
              partialText: prev.pendingTurn!.partialText + (event.text ?? '')
            }
          }
        }
        if (event.kind === 'done') {
          if (!isForCurrentView) {
            // Background session finished. Just drop pendingTurn if
            // it happens to belong to that turn; otherwise no-op.
            if (matchesPending) return { ...prev, pendingTurn: null }
            return prev
          }
          if (!matchesPending) {
            // 'done' is for the session the user is currently viewing,
            // but we don't have a matching pendingTurn — usually means
            // they switched away and back while the turn was in flight,
            // so the in-memory chatMessages array doesn't include the
            // assistant reply. Refresh from ChatStore as a safety net.
            // (Main always persists the message before sending 'done'.)
            if (event.sessionId) {
              window.petAPI
                .getChatSession(event.sessionId)
                .then((s) => {
                  if (!s) return
                  setState((p) => ({
                    ...p,
                    chatMessages: s.messages.map((m) => ({
                      id: m.id,
                      role: m.role,
                      text: m.text
                    }))
                  }))
                })
                .catch(() => undefined)
            }
            return prev
          }
          const finalText = event.text ?? prev.pendingTurn!.partialText
          return {
            ...prev,
            pendingTurn: null,
            chatMessages: [
              ...prev.chatMessages,
              { id: `a-${event.turnId}`, role: 'assistant', text: finalText }
            ],
            replyPreview: { text: finalText, completedAt: Date.now() }
          }
        }
        if (event.kind === 'error') {
          if (!isForCurrentView) {
            if (matchesPending) return { ...prev, pendingTurn: null }
            return prev
          }
          if (!matchesPending) {
            // Same safety net as 'done': re-sync from ChatStore in
            // case the user switched away while the turn errored.
            if (event.sessionId) {
              window.petAPI
                .getChatSession(event.sessionId)
                .then((s) => {
                  if (!s) return
                  setState((p) => ({
                    ...p,
                    chatMessages: s.messages.map((m) => ({
                      id: m.id,
                      role: m.role,
                      text: m.text
                    }))
                  }))
                })
                .catch(() => undefined)
            }
            return prev
          }
          const errText = event.error ?? 'unknown error'
          return {
            ...prev,
            pendingTurn: null,
            chatMessages: [
              ...prev.chatMessages,
              { id: `e-${event.turnId}`, role: 'error', text: errText }
            ],
            replyPreview: { text: '出错: ' + errText, completedAt: Date.now() }
          }
        }
        return prev
      })
    })

    cleanupRef.current = () => {
      cleanupAgent()
      cleanupConfig()
      cleanupChat()
    }
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  // Auto-expire the reply preview after a while so the status label
  // returns to whatever the agent state would otherwise show.
  useEffect(() => {
    if (!state.replyPreview) return
    const elapsed = Date.now() - state.replyPreview.completedAt
    const remaining = Math.max(0, PREVIEW_TTL_MS - elapsed)
    const t = setTimeout(() => {
      setState((prev) =>
        prev.replyPreview && prev.replyPreview.completedAt === state.replyPreview!.completedAt
          ? { ...prev, replyPreview: null }
          : prev
      )
    }, remaining)
    return () => clearTimeout(t)
  }, [state.replyPreview])

  // Re-scan ~/.codex/pets, ~/.petdex/pets, ~/.claude/pets on demand —
  // users may install new pets from petdex while pet is running and
  // expect them to appear without restart.
  const handleReloadPets = useCallback(async (): Promise<void> => {
    try {
      const pets = await window.petAPI.getPets()
      setState((prev) => ({ ...prev, pets }))
    } catch (err) {
      console.error('[App] reload pets:', err)
    }
  }, [])

  const handleChangePet = async (petId: string): Promise<void> => {
    try {
      await window.petAPI.setActivePet(petId)
      const pet = state.pets.find((p) => p.id === petId)
      setState((prev) => ({
        ...prev,
        activePetId: petId,
        spritesheetUrl: pet ? toFileUrl(pet.spritesheetAbsPath) : prev.spritesheetUrl
      }))
    } catch (err) {
      console.error('[App] changePet error:', err)
    }
  }

  const handleScaleChange = async (scale: number): Promise<void> => {
    try {
      await window.petAPI.setConfig('petScale', scale)
      setState((prev) => ({ ...prev, petScale: scale }))
    } catch (err) {
      console.error('[App] scaleChange error:', err)
    }
  }

  const handlePositionChange = useCallback((pos: { x: number; y: number }): void => {
    window.petAPI.setConfig('position', pos).catch((err) => {
      console.error('[App] position save error:', err)
    })
  }, [])

  // After every send, clear all staged attachments so the next message
  // doesn't accidentally resend them.
  const handleSetPreferredProvider = useCallback(
    async (providerId: string, modelId?: string): Promise<void> => {
      let switchedProvider = false
      setState((prev) => {
        const p = prev.providers.find((x) => x.id === providerId)
        const nextModel = modelId ?? p?.defaultModel
        if (
          prev.preferredProviderId === providerId &&
          prev.preferredModelId === nextModel
        ) {
          return prev
        }
        switchedProvider = prev.preferredProviderId !== providerId
        return {
          ...prev,
          preferredProviderId: providerId,
          preferredModelId: nextModel
        }
      })
      // Persist so the choice survives restarts.
      try {
        await window.petAPI.setConfig('preferredProviderId', providerId)
        await window.petAPI.setConfig('preferredModelId', modelId ?? null)
      } catch (err) {
        console.error('[App] save preferred provider failed:', err)
      }
      // Switching the active framework mid-session would corrupt the
      // running agent's context, so auto-start a fresh session whenever
      // the provider itself changes. (Model-only changes don't.)
      if (switchedProvider) {
        try {
          await window.petAPI.newChatSession()
        } catch (err) {
          console.error('[App] newChatSession on provider switch failed:', err)
        }
        setState((prev) => ({
          ...prev,
          activeSessionId: null,
          chatMessages: [],
          pendingTurn: null,
          replyPreview: null
        }))
      }
    },
    []
  )

  const handleSendChat = useCallback(
    async (
      text: string,
      images?: Array<{ base64: string; mediaType: string }>
    ): Promise<void> => {
      const trimmed = text.trim()
      const imgs = images ?? []
      if (!trimmed && imgs.length === 0) return
      const displayText = trimmed || (imgs.length > 0 ? '(图片)' : '')
      const imgTag = imgs.length > 0 ? `\n[图片 ×${imgs.length}]` : ''
      setState((prev) => ({
        ...prev,
        chatMessages: [
          ...prev.chatMessages,
          {
            id: `u-${Date.now()}`,
            role: 'user',
            text: displayText + imgTag
          }
        ],
        replyPreview: null,
        chatAttachments: []
      }))
      try {
        // Multi-image stream-json input: pack everything into one user
        // turn via chat-send-multi (single API on main side accepting
        // an array). For backward compat, when only one image is given
        // we still hit the original sendChat.
        // For brand-new (empty) sessions, send the user's preferred
        // provider/model so main can lock it in. Existing sessions
        // ignore these — they keep whatever provider was first used.
        // Read from the live ref, NOT the captured `state` — this
        // callback's deps are [] so its closure has the initial state.
        const live = stateRef.current ?? state
        const isNewSession =
          live.activeSessionId === null || live.chatMessages.length === 0
        const providerId = isNewSession ? live.preferredProviderId : undefined
        const modelId = isNewSession ? live.preferredModelId : undefined
        if (imgs.length <= 1) {
          await window.petAPI.sendChat({
            text: trimmed || '帮我看看这张截图。',
            imageBase64: imgs[0]?.base64,
            imageMediaType: imgs[0]?.mediaType,
            providerId,
            modelId
          })
        } else {
          await window.petAPI.sendChatMulti({
            text: trimmed || '帮我看看这些截图。',
            images: imgs,
            providerId,
            modelId
          })
        }
      } catch (err) {
        setState((prev) => ({
          ...prev,
          chatMessages: [
            ...prev.chatMessages,
            { id: `e-${Date.now()}`, role: 'error', text: String(err) }
          ],
          pendingTurn: null
        }))
      }
    },
    []
  )

  const handleClearReplyPreview = useCallback(() => {
    setState((prev) => (prev.replyPreview ? { ...prev, replyPreview: null } : prev))
  }, [])

  const handleNewSession = useCallback(async (): Promise<void> => {
    // Lazy: do NOT create a session row up front. Just clear local state;
    // the next sendChat will materialize a new session on demand.
    await window.petAPI.newChatSession()
    setState((prev) => ({
      ...prev,
      activeSessionId: null,
      chatMessages: [],
      pendingTurn: null,
      replyPreview: null
    }))
  }, [])

  const handleSwitchSession = useCallback(async (sessionId: string): Promise<void> => {
    await window.petAPI.setActiveChatSession(sessionId)
    const session = await window.petAPI.getChatSession(sessionId)
    if (!session) return
    setState((prev) => ({
      ...prev,
      activeSessionId: sessionId,
      chatMessages: session.messages.map((m) => ({ id: m.id, role: m.role, text: m.text })),
      // Keep pendingTurn ONLY if it belongs to the session we're
      // switching to (user is returning to a still-in-flight chat).
      // Drop it if it belongs to some other session — that turn's
      // bubble shouldn't show in the new view; it will eventually
      // persist its reply into ChatStore which we'll see on next
      // switch back.
      pendingTurn:
        prev.pendingTurn && prev.pendingTurn.sessionId === sessionId
          ? prev.pendingTurn
          : null,
      replyPreview: null
    }))
  }, [])

  const handleCaptureScreen = useCallback(
    async (mode: 'full' | 'region'): Promise<void> => {
      const r = await window.petAPI.captureScreen(mode)
      if (r.ok && r.base64 && r.mediaType) {
        const att = { base64: r.base64, mediaType: r.mediaType }
        setState((prev) => ({
          ...prev,
          chatAttachments: [...prev.chatAttachments, att]
        }))
        return
      }
      // Surface non-ok captures into the chat so users on platforms
      // where screenshots aren't supported (Linux/Windows) see WHY
      // the click did nothing instead of silently swallowing.
      if (r.reason && r.reason !== 'canceled') {
        const msg =
          r.reason === 'unsupported'
            ? '截图功能暂只支持 macOS（基于 screencapture 实现）'
            : `截图失败：${r.error ?? r.reason}`
        setState((prev) => ({
          ...prev,
          chatMessages: [
            ...prev.chatMessages,
            { id: `e-${Date.now()}`, role: 'error', text: msg }
          ]
        }))
      }
    },
    []
  )

  const handleAddAttachment = useCallback(
    (att: { base64: string; mediaType: string }) => {
      setState((prev) => ({
        ...prev,
        chatAttachments: [...prev.chatAttachments, att]
      }))
    },
    []
  )

  const handleRemoveAttachment = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      chatAttachments: prev.chatAttachments.filter((_, i) => i !== index)
    }))
  }, [])

  const handleClearAttachments = useCallback(() => {
    setState((prev) =>
      prev.chatAttachments.length > 0 ? { ...prev, chatAttachments: [] } : prev
    )
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string): Promise<void> => {
    const { activeSessionId } = await window.petAPI.deleteChatSession(sessionId)
    const sessions = await window.petAPI.listChatSessions()
    let messages: ChatMessage[] = []
    if (activeSessionId) {
      const s = await window.petAPI.getChatSession(activeSessionId)
      if (s) messages = s.messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
    }
    setState((prev) => ({
      ...prev,
      activeSessionId,
      chatMessages: messages,
      chatSessions: sessions.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt }))
    }))
  }, [])

  if (!state.initialPosition || !state.screenBounds) {
    return <div style={{ width: '100vw', height: '100vh', background: 'transparent' }} />
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        overflow: 'hidden'
      }}
    >
      <PetWidget
        spritesheetUrl={state.spritesheetUrl}
        agentAnimState={state.agentAnimState}
        statusLabel={state.statusLabel}
        pets={state.pets}
        activePetId={state.activePetId}
        petScale={state.petScale}
        initialPosition={state.initialPosition}
        screenBounds={state.screenBounds}
        chatMessages={state.chatMessages}
        pendingTurn={state.pendingTurn}
        replyPreview={state.replyPreview}
        chatSessions={state.chatSessions}
        activeSessionId={state.activeSessionId}
        chatAttachments={state.chatAttachments}
        providers={state.providers}
        preferredProviderId={state.preferredProviderId}
        preferredModelId={state.preferredModelId}
        onSetPreferredProvider={handleSetPreferredProvider}
        onChangePet={handleChangePet}
        onReloadPets={handleReloadPets}
        onScaleChange={handleScaleChange}
        onPositionChange={handlePositionChange}
        onSendChat={(text, images) => void handleSendChat(text, images)}
        onClearReplyPreview={handleClearReplyPreview}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
        onDeleteSession={handleDeleteSession}
        onCaptureScreen={(mode) => void handleCaptureScreen(mode)}
        onAddAttachment={handleAddAttachment}
        onRemoveAttachment={handleRemoveAttachment}
        onClearAttachments={handleClearAttachments}
      />
    </div>
  )
}
