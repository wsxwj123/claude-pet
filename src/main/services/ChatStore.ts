import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

/**
 * Persists chat sessions to a single JSON file under ~/.claude/.
 *
 * Why JSON instead of SQLite: better-sqlite3 needs an electron-rebuild
 * step that breaks under the default dev workflow. For < 10 MB of chat
 * transcripts, a synchronous read/write on session boundaries is fast
 * enough. The schema below matches what a SQLite migration would expose,
 * so swapping the backend later is a drop-in change.
 */

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  createdAt: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
  // Provider this session uses (e.g. 'claude-cli', 'opencode'). Locked
  // for the lifetime of the session — switching mid-conversation would
  // break context, so the UI hides the picker once messages exist.
  providerId?: string
  /** Model id passed to the provider for every turn. */
  modelId?: string
  // Native session/thread id the underlying agent CLI uses to keep
  // conversational context (Claude's session UUID, codex's thread_id,
  // opencode's sessionID, ...). Captured from the first turn's init
  // event so subsequent turns can resume. Generic across providers.
  nativeSessionId?: string | null
  // Kept for backward compat with chat.json files written before the
  // rename. Loaded into nativeSessionId on first read.
  claudeSessionId?: string | null
}

interface StoreShape {
  version: 1
  sessions: ChatSession[]
}

// Chat history lives next to the rest of pet's data so users running
// without Claude Code installed still get persistent sessions.
const STORE_DIR = path.join(os.homedir(), '.claude-pets')
const STORE_PATH = path.join(STORE_DIR, 'chat.json')
const LEGACY_STORE_PATH = path.join(os.homedir(), '.claude', 'claude-pets-chat.json')

function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function titleFromText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.slice(0, 30) || '新会话'
}

export class ChatStore {
  private store: StoreShape

  constructor() {
    this.store = this.load()
    // Purge sessions that were created but never received any message —
    // those are leftover "new chat" clicks the user never followed up on.
    const before = this.store.sessions.length
    this.store.sessions = this.store.sessions.filter((s) => s.messages.length > 0)
    if (this.store.sessions.length !== before) this.save()
  }

  setNativeSessionId(sessionId: string, nativeId: string): void {
    const s = this.store.sessions.find((x) => x.id === sessionId)
    if (!s || s.nativeSessionId) return
    s.nativeSessionId = nativeId
    this.save()
  }

  /** @deprecated Use setNativeSessionId. Kept so older callers still compile. */
  setClaudeSessionId(sessionId: string, claudeId: string): void {
    this.setNativeSessionId(sessionId, claudeId)
  }

  private load(): StoreShape {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8')
        const parsed = raw.trim() ? JSON.parse(raw) : null
        if (parsed && parsed.version === 1 && Array.isArray(parsed.sessions)) {
          return parsed as StoreShape
        }
      }
      // One-time migration from ~/.claude/claude-pets-chat.json.
      if (fs.existsSync(LEGACY_STORE_PATH)) {
        const raw = fs.readFileSync(LEGACY_STORE_PATH, 'utf-8')
        const parsed = raw.trim() ? JSON.parse(raw) : null
        if (parsed && parsed.version === 1 && Array.isArray(parsed.sessions)) {
          try {
            if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true })
            fs.writeFileSync(STORE_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
            console.log(
              `[ChatStore] migrated chat history from ${LEGACY_STORE_PATH} to ${STORE_PATH}`
            )
          } catch {
            /* ignore migration write errors */
          }
          return parsed as StoreShape
        }
      }
    } catch (err) {
      console.error('[ChatStore] load failed:', err)
    }
    return { version: 1, sessions: [] }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.store, null, 2) + '\n', 'utf-8')
    } catch (err) {
      console.error('[ChatStore] save failed:', err)
    }
  }

  createSession(providerId?: string, modelId?: string): ChatSession {
    const now = Date.now()
    const session: ChatSession = {
      id: newId(),
      title: '新会话',
      createdAt: now,
      updatedAt: now,
      messages: [],
      providerId,
      modelId
    }
    this.store.sessions.push(session)
    this.save()
    return session
  }

  setSessionProvider(sessionId: string, providerId: string, modelId?: string): void {
    const s = this.store.sessions.find((x) => x.id === sessionId)
    if (!s) return
    // Only allow setting provider before any messages exist; once a
    // conversation starts, the provider is locked.
    if (s.messages.length > 0) return
    s.providerId = providerId
    s.modelId = modelId
    this.save()
  }

  appendMessage(sessionId: string, msg: Omit<StoredMessage, 'createdAt'>): void {
    const session = this.store.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const stored: StoredMessage = { ...msg, createdAt: Date.now() }
    session.messages.push(stored)
    session.updatedAt = stored.createdAt
    // Auto-title from first user message
    if (session.title === '新会话' && msg.role === 'user') {
      session.title = titleFromText(msg.text)
    }
    this.save()
  }

  listSessions(): Array<Omit<ChatSession, 'messages'>> {
    return this.store.sessions
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSession(sessionId: string): ChatSession | null {
    const s = this.store.sessions.find((x) => x.id === sessionId)
    if (!s) return null
    // Back-compat: older chat.json files only had claudeSessionId.
    if (!s.nativeSessionId && s.claudeSessionId) {
      s.nativeSessionId = s.claudeSessionId
    }
    return s
  }

  deleteSession(sessionId: string): void {
    this.store.sessions = this.store.sessions.filter((s) => s.id !== sessionId)
    this.save()
  }

  /** Return the most recently updated session, or null if none exist. */
  mostRecent(): ChatSession | null {
    if (this.store.sessions.length === 0) return null
    return [...this.store.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }
}
