import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'
import type { PetDescriptor } from '../../shared/types'

export type { PetDescriptor }

interface PetJson {
  id: string
  displayName: string
  description: string
  spritesheetPath?: string
}

/**
 * Locations pet looks for sprite packs, in priority order. Earlier dirs
 * win when the same `id` appears in multiple places. Cross-platform:
 * `os.homedir()` yields `/Users/x` on macOS, `/home/x` on Linux,
 * `C:\Users\x` on Windows.
 *
 * - Bundled pet (`<resources>/pets/clawd`) — ships with pet so a fresh
 *   install has at least one sprite to render. Lowest priority so
 *   user-installed pets override the default if they share an id.
 * - `~/.claude-pets/pets` — pet's own user dir (preferred new location)
 * - `~/.codex/pets`, `~/.petdex/pets`, `~/.claude/pets` — legacy /
 *   compatibility paths used by petdex and friends. Kept so existing
 *   users don't have to move files.
 */
function bundledPetsDir(): string {
  // In dev: process.resourcesPath = .../electron/dist/.../Resources
  // (Electron's own resources, no pets there). Fall back to repo
  // assets/ dir relative to __dirname.
  // In production (packaged): asar resources live at
  // process.resourcesPath/assets/pets when we ship them as files: ['assets/**/*'].
  const candidates: string[] = []
  if (app && app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'assets', 'pets'))
  }
  // Dev: __dirname = .../out/main → go up to project root + assets
  candidates.push(path.join(__dirname, '..', '..', 'assets', 'pets'))
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[candidates.length - 1] // last resort, may not exist
}

function userPetDirs(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.claude-pets', 'pets'),
    path.join(home, '.petdex', 'pets'),
    path.join(home, '.codex', 'pets'),
    path.join(home, '.claude', 'pets')
  ]
}

export class PetLoader {
  /** All dirs we scan; exported so the UI can show users where to put pet packs. */
  scanDirs(): string[] {
    return [...userPetDirs(), bundledPetsDir()]
  }

  loadAll(): PetDescriptor[] {
    const pets: PetDescriptor[] = []
    const seen = new Set<string>()

    for (const dir of this.scanDirs()) {
      if (!fs.existsSync(dir)) continue

      let entries: string[]
      try {
        entries = fs.readdirSync(dir)
      } catch {
        continue
      }

      for (const entry of entries) {
        const petDir = path.join(dir, entry)
        try {
          const stat = fs.statSync(petDir)
          if (!stat.isDirectory()) continue
        } catch {
          continue
        }

        const jsonPath = path.join(petDir, 'pet.json')
        if (!fs.existsSync(jsonPath)) continue

        let petJson: PetJson
        try {
          petJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        } catch {
          continue
        }

        const petId = petJson.id || entry
        if (seen.has(petId)) continue
        seen.add(petId)

        // Resolve spritesheet path
        let spritesheetAbsPath = ''
        if (petJson.spritesheetPath) {
          spritesheetAbsPath = path.isAbsolute(petJson.spritesheetPath)
            ? petJson.spritesheetPath
            : path.join(petDir, petJson.spritesheetPath)
        } else {
          for (const name of ['spritesheet.webp', 'spritesheet.png', 'sprite.webp', 'sprite.png']) {
            const candidate = path.join(petDir, name)
            if (fs.existsSync(candidate)) {
              spritesheetAbsPath = candidate
              break
            }
          }
        }

        if (!spritesheetAbsPath || !fs.existsSync(spritesheetAbsPath)) continue

        pets.push({
          id: petId,
          displayName: petJson.displayName || petId,
          description: petJson.description || '',
          spritesheetAbsPath
        })
      }
    }

    return pets
  }
}
