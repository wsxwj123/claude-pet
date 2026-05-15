import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PetConfig } from '../../shared/types'

export type { PetConfig }

// Pet's own config lives under ~/.claude-pets/ (parallel to the
// provider dir at ~/.claude-pets/providers/) so a user can run pet
// without ever having installed Claude Code. We keep a one-time
// migration from the legacy ~/.claude/claude-pets-config.json path so
// existing installs don't lose their preferences.
const CONFIG_DIR = path.join(os.homedir(), '.claude-pets')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const LEGACY_CONFIG_PATH = path.join(os.homedir(), '.claude', 'claude-pets-config.json')

const DEFAULT_CONFIG: PetConfig = {
  activePet: 'clawd',
  petScale: 0.4,
  position: { x: 50, y: 300 },
  preferredProviderId: 'claude-cli',
  preferredModelId: 'sonnet',
  chatPanelWidth: 360,
  chatPanelHeight: 460,
  shortcuts: {
    toggleChat: 'Cmd+Shift+C',
    screenshotAnalysis: 'Cmd+Shift+S',
    toggleVisible: 'Cmd+Shift+H'
  }
}

export class ConfigStore {
  private config: PetConfig

  constructor() {
    this.config = this.load()
  }

  private load(): PetConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
      }
      // One-time migration from the legacy path. Read but don't delete
      // the old file — keep it as a backup the user can manually remove.
      if (fs.existsSync(LEGACY_CONFIG_PATH)) {
        const raw = fs.readFileSync(LEGACY_CONFIG_PATH, 'utf-8')
        const migrated = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
        // Write to new location so subsequent loads skip the legacy
        // probe and so the user can see where pet stores its config now.
        try {
          if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf-8')
          console.log(
            `[ConfigStore] migrated config from ${LEGACY_CONFIG_PATH} to ${CONFIG_PATH}`
          )
        } catch {
          /* ignore migration write errors — load still works */
        }
        return migrated
      }
    } catch {
      // fall through to default
    }
    return { ...DEFAULT_CONFIG }
  }

  get(): PetConfig {
    return { ...this.config }
  }

  set(key: keyof PetConfig, value: unknown): void {
    (this.config as unknown as Record<string, unknown>)[key] = value
    this.save()
  }

  private save(): void {
    try {
      const dir = path.dirname(CONFIG_PATH)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ConfigStore] Failed to save config:', err)
    }
  }
}
