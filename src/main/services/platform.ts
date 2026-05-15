import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Cross-platform helpers for finding CLI binaries (claude, opencode,
 * openclaude, ffmpeg, etc.) that pet needs to spawn.
 *
 * Why we need this: Electron apps started from the GUI (Finder, GNOME
 * Activities) inherit a minimal PATH — usually just `/usr/bin:/bin`.
 * Most CLI agents users actually have are installed via Homebrew,
 * Bun, npm-global, or asdf, which write to non-standard paths. We
 * prepend every plausible install location and probe a list of
 * candidate paths when checking `available`.
 */

const HOME = os.homedir()
const PLATFORM = process.platform // 'darwin' | 'linux' | 'win32' | ...

/**
 * Directories likely to contain user-installed CLI binaries on the
 * current OS. Order matters — earlier wins.
 */
export function commonBinDirs(): string[] {
  if (PLATFORM === 'darwin') {
    return [
      '/opt/homebrew/bin', // Apple Silicon Homebrew
      '/usr/local/bin', // Intel Homebrew + many system installs
      path.join(HOME, '.bun', 'bin'),
      path.join(HOME, '.local', 'bin'),
      path.join(HOME, '.npm-global', 'bin'),
      path.join(HOME, '.opencode', 'bin'),
      path.join(HOME, '.cargo', 'bin'),
      path.join(HOME, '.asdf', 'shims'),
      // macOS apps that ship a CLI inside their bundle. Codex.app
      // (brew install --cask codex) embeds `codex` here rather than
      // adding to PATH. Add more as needed.
      '/Applications/Codex.app/Contents/Resources',
      '/usr/bin',
      '/bin'
    ]
  }
  if (PLATFORM === 'linux') {
    return [
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      path.join(HOME, '.local', 'bin'),
      path.join(HOME, '.bun', 'bin'),
      path.join(HOME, '.npm-global', 'bin'),
      path.join(HOME, '.opencode', 'bin'),
      path.join(HOME, '.cargo', 'bin'),
      path.join(HOME, '.asdf', 'shims'),
      // Snap installs sometimes land here
      '/snap/bin'
    ]
  }
  // Windows — leave PATH mostly to user env. Common install roots:
  if (PLATFORM === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(HOME, 'AppData', 'Local')
    const appData = process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming')
    return [
      path.join(localAppData, 'Programs'),
      path.join(appData, 'npm'),
      path.join(HOME, '.bun', 'bin'),
      path.join(HOME, '.cargo', 'bin')
    ]
  }
  return []
}

/**
 * Build the PATH env value to give to child_process.spawn. Returns the
 * common dirs prepended to whatever PATH the Electron process inherited.
 */
export function spawnPath(): string {
  const sep = PLATFORM === 'win32' ? ';' : ':'
  return [...commonBinDirs(), process.env.PATH ?? ''].filter(Boolean).join(sep)
}

/**
 * Look for a binary by name (e.g. "claude", "opencode") across every
 * plausible install dir, OR validate an absolute path directly.
 * Returns the first absolute path that exists, or null. On Windows,
 * also tries `.exe` / `.cmd` suffixes.
 */
export function resolveBinary(nameOrPath: string): string | null {
  if (!nameOrPath) return null
  // Absolute or starts-with-./~ path: check it directly.
  if (path.isAbsolute(nameOrPath)) {
    try {
      if (fs.existsSync(nameOrPath) && fs.statSync(nameOrPath).isFile()) return nameOrPath
    } catch {
      /* ignore */
    }
    return null
  }
  const candidates: string[] = []
  for (const dir of commonBinDirs()) {
    if (PLATFORM === 'win32') {
      candidates.push(
        path.join(dir, nameOrPath + '.exe'),
        path.join(dir, nameOrPath + '.cmd'),
        path.join(dir, nameOrPath)
      )
    } else {
      candidates.push(path.join(dir, nameOrPath))
    }
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Quick boolean version of resolveBinary — for provider `available`
 * flags. Cheap (existsSync), safe to call repeatedly.
 */
export function hasBinary(name: string): boolean {
  return resolveBinary(name) !== null
}

/**
 * Build spawn options that work cross-platform for a given binary
 * name. Resolves to absolute path (Windows spawn won't auto-resolve
 * .exe/.cmd extensions), and enables `shell: true` for .cmd/.bat
 * shims (npm-global on Windows installs CLIs as .cmd wrappers).
 */
export function resolveSpawn(bin: string): { command: string; shell: boolean } {
  const abs = resolveBinary(bin) ?? bin
  const shell = /\.(cmd|bat|ps1)$/i.test(abs)
  return { command: abs, shell }
}
