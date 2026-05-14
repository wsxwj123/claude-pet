import fs from 'fs'
import path from 'path'
import os from 'os'
import { Provider, ProviderInfo } from './Provider'
import { ClaudeCliProvider } from './ClaudeCliProvider'
import { OpenCodeProvider } from './OpenCodeProvider'
import { OpenClaudeProvider } from './OpenClaudeProvider'
import { CodexProvider } from './CodexProvider'
import { JsonProvider, JsonProviderSpec } from './JsonProvider'
import { AgentStateManager } from '../AgentStateManager'

const CUSTOM_PROVIDER_DIR = path.join(os.homedir(), '.claude-pets', 'providers')

/**
 * Holds all registered providers and exposes them to the renderer.
 *
 * - Built-ins (claude-cli, opencode) are registered at construction.
 * - User-defined providers under ~/.claude-pets/providers/*.json are
 *   scanned and loaded on startup. Each JSON declares a CLI invocation
 *   pattern via JsonProviderSpec, no code required.
 *
 * Providers are addressed by id. Resolution falls back to claude-cli
 * when an unknown id is requested.
 */
export class ProviderRegistry {
  private providers = new Map<string, Provider>()
  private defaultProviderId: string

  constructor(agentState: AgentStateManager | null = null) {
    this.agentState = agentState
    const claude = new ClaudeCliProvider()
    const codex = new CodexProvider('codex', agentState)
    const opencode = new OpenCodeProvider('opencode', agentState)
    const openclaude = new OpenClaudeProvider('openclaude', agentState)
    this.providers.set(claude.info.id, claude)
    this.providers.set(codex.info.id, codex)
    this.providers.set(opencode.info.id, opencode)
    this.providers.set(openclaude.info.id, openclaude)
    this.defaultProviderId = claude.info.id

    this.loadCustomProviders()

    // Visibility on startup: which built-in providers were detected.
    // Helps users debug "Claude/opencode shows as 未安装 even though I
    // have it" without opening DevTools.
    for (const p of this.providers.values()) {
      console.log(
        `[ProviderRegistry] ${p.info.id}: ${
          p.info.available ? '✓ available' : '✗ not installed'
        } (${p.info.models.length} models)`
      )
    }
  }

  private agentState: AgentStateManager | null = null

  private loadCustomProviders(): void {
    try {
      if (!fs.existsSync(CUSTOM_PROVIDER_DIR)) return
      const files = fs
        .readdirSync(CUSTOM_PROVIDER_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(CUSTOM_PROVIDER_DIR, f))
      for (const file of files) {
        try {
          const raw = fs.readFileSync(file, 'utf-8')
          const spec = JSON.parse(raw) as JsonProviderSpec
          const provider = new JsonProvider(spec, this.agentState)
          if (this.providers.has(provider.info.id)) {
            console.warn(
              `[ProviderRegistry] '${provider.info.id}' from ${file} overrides built-in; built-in kept`
            )
            continue
          }
          this.providers.set(provider.info.id, provider)
          console.log(`[ProviderRegistry] loaded custom provider '${provider.info.id}' from ${file}`)
        } catch (err) {
          console.error(`[ProviderRegistry] failed to load ${file}:`, err)
        }
      }
    } catch (err) {
      console.error('[ProviderRegistry] scan failed:', err)
    }
  }

  list(): ProviderInfo[] {
    return Array.from(this.providers.values()).map((p) => p.info)
  }

  get(id: string | null | undefined): Provider {
    if (id && this.providers.has(id)) return this.providers.get(id)!
    return this.providers.get(this.defaultProviderId)!
  }

  defaultId(): string {
    return this.defaultProviderId
  }
}
