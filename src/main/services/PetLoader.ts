import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PetDescriptor } from '../../shared/types'

export type { PetDescriptor }

interface PetJson {
  id: string
  displayName: string
  description: string
  spritesheetPath?: string
}

const PET_DIRS = [
  path.join(os.homedir(), '.codex', 'pets'),
  path.join(os.homedir(), '.petdex', 'pets'),
  path.join(os.homedir(), '.claude', 'pets')
]

export class PetLoader {
  loadAll(): PetDescriptor[] {
    const pets: PetDescriptor[] = []
    const seen = new Set<string>()

    for (const dir of PET_DIRS) {
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
          // Try common filenames
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
