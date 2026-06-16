import { app, net } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { UpdateAsset, UpdateCheckResult, UpdateProgress } from '../../shared/types'

export type { UpdateAsset } from '../../shared/types'

// Self-update for the UNSIGNED app. macOS' native autoUpdater (Squirrel.Mac)
// requires a code-signed app, which this project isn't, so we roll our own:
// fetch the latest GitHub release, download the platform/arch asset, then a
// detached shell script swaps the installed binary after this process exits
// and relaunches it.
//
// Repo is hard-coded — it's our own release source, not user input.
const REPO = 'wsxwj123/claude-pet'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** Parse "v1.2.3" / "1.2.3" → [1,2,3]. Non-numeric segments become 0. */
function parseVersion(v: string): number[] {
  const m = v.replace(/^v/i, '').split('.').map((s) => parseInt(s, 10))
  return [m[0] || 0, m[1] || 0, m[2] || 0]
}

/** Returns true if `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

/**
 * Pick the release asset matching this platform + arch. Matching mirrors
 * electron-builder's output naming (see package.json build config):
 *   macOS arm64 → *-arm64-mac.zip   · macOS x64 → *-mac.zip
 *   Windows     → *.exe
 *   Linux arm64 → *-arm64.AppImage  · Linux x64 → *.AppImage
 */
function pickAsset(assets: UpdateAsset[]): UpdateAsset | undefined {
  const { platform, arch } = process
  if (platform === 'darwin') {
    if (arch === 'arm64') return assets.find((a) => a.name.endsWith('-arm64-mac.zip'))
    return assets.find((a) => a.name.endsWith('-mac.zip') && !a.name.includes('-arm64-'))
  }
  if (platform === 'win32') {
    return assets.find((a) => a.name.endsWith('.exe'))
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return assets.find((a) => a.name.endsWith('-arm64.AppImage'))
    return assets.find((a) => a.name.endsWith('.AppImage') && !a.name.includes('-arm64'))
  }
  return undefined
}

/** GET a URL with Electron's net (follows redirects, respects system proxy). */
function httpGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', 'claude-pets-updater')
    req.setHeader('Accept', 'application/vnd.github+json')
    req.on('response', (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`))
        res.on('data', () => {})
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch (e) {
          reject(e instanceof Error ? e : new Error('parse error'))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** Download a URL to `dest`, reporting progress. */
function downloadFile(
  url: string,
  dest: string,
  expectedSize: number,
  onProgress?: (p: UpdateProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', 'claude-pets-updater')
    req.on('response', (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const total = parseInt(String(res.headers['content-length'] ?? ''), 10) || expectedSize
      let received = 0
      const out = fs.createWriteStream(dest)
      res.on('data', (c) => {
        const buf = Buffer.from(c)
        received += buf.length
        out.write(buf)
        onProgress?.({
          receivedBytes: received,
          totalBytes: total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
        })
      })
      res.on('end', () => out.end(() => resolve()))
      res.on('error', (e) => {
        out.destroy()
        reject(e)
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const base = { ok: false, currentVersion, releasesPage: RELEASES_PAGE }
  try {
    const data = (await httpGetJson(LATEST_API)) as {
      tag_name?: string
      assets?: Array<{ name: string; browser_download_url: string; size: number }>
    }
    const latestVersion = (data.tag_name ?? '').replace(/^v/i, '')
    if (!latestVersion) return { ...base, error: '无法解析最新版本号' }
    const assets: UpdateAsset[] = (data.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size
    }))
    const hasUpdate = isNewer(latestVersion, currentVersion)
    const asset = pickAsset(assets)
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      asset,
      noAsset: hasUpdate && !asset,
      releasesPage: RELEASES_PAGE
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : '检查更新失败' }
  }
}

/** Run a shell command, resolving on exit code 0. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

/**
 * Download the asset and kick off the platform-specific install. On success
 * for mac/linux this quits the app and relaunches the new build; for Windows
 * it launches the NSIS installer and quits. Returns only on FAILURE (with a
 * message) — on success the process is on its way out.
 */
export async function downloadAndInstall(
  asset: UpdateAsset,
  onProgress?: (p: UpdateProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  const workDir = path.join(os.tmpdir(), 'claude-pets-update')
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  fs.mkdirSync(workDir, { recursive: true })
  const downloadPath = path.join(workDir, asset.name)

  try {
    await downloadFile(asset.url, downloadPath, asset.size, onProgress)
  } catch (e) {
    return { ok: false, error: `下载失败：${e instanceof Error ? e.message : e}` }
  }

  try {
    if (process.platform === 'darwin') return await installMac(downloadPath, workDir)
    if (process.platform === 'win32') return installWindows(downloadPath)
    if (process.platform === 'linux') return installLinux(downloadPath)
    return { ok: false, error: '当前平台不支持自动更新' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '安装失败' }
  }
}

async function installMac(zipPath: string, workDir: string): Promise<{ ok: boolean; error?: string }> {
  // execPath = /Applications/claude-pets.app/Contents/MacOS/claude-pets
  const exe = process.execPath
  const marker = '.app/Contents/MacOS/'
  const idx = exe.indexOf(marker)
  if (idx < 0) return { ok: false, error: '开发模式下不支持自动更新（请打包后使用）' }
  const appPath = exe.slice(0, idx + '.app'.length)
  const parentDir = path.dirname(appPath)

  // Pre-flight: can we write where the app lives? If not, the detached
  // script would silently fail after we've already quit.
  try {
    fs.accessSync(parentDir, fs.constants.W_OK)
  } catch {
    return { ok: false, error: `无写入权限：${parentDir}（请将 app 放到有权限的位置）` }
  }

  // Unzip into workDir, then locate the extracted .app.
  const extractDir = path.join(workDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])
  const newApp = fs
    .readdirSync(extractDir)
    .map((n) => path.join(extractDir, n))
    .find((p) => p.endsWith('.app'))
  if (!newApp) return { ok: false, error: '解压后未找到 .app' }

  const script = `#!/bin/bash
set -e
DST="$1"
SRC="$2"
# Wait for this (the old) process to exit before swapping.
for i in $(seq 1 100); do
  pgrep -f "$DST/Contents/MacOS/" >/dev/null 2>&1 || break
  sleep 0.2
done
rm -rf "$DST"
/usr/bin/ditto "$SRC" "$DST"
/usr/bin/xattr -dr com.apple.quarantine "$DST" 2>/dev/null || true
open "$DST"
`
  const scriptPath = path.join(workDir, 'install.sh')
  fs.writeFileSync(scriptPath, script, { mode: 0o755 })

  spawnDetached('/bin/bash', [scriptPath, appPath, newApp])
  quitSoon()
  return { ok: true }
}

function installWindows(exePath: string): { ok: boolean; error?: string } {
  // Launch the NSIS installer; it upgrades the existing install in place.
  spawnDetached(exePath, [])
  quitSoon()
  return { ok: true }
}

function installLinux(appImagePath: string): { ok: boolean; error?: string } {
  const current = process.env.APPIMAGE
  if (!current) {
    return { ok: false, error: '非 AppImage 运行（deb 等请用包管理器更新）' }
  }
  try {
    fs.accessSync(path.dirname(current), fs.constants.W_OK)
  } catch {
    return { ok: false, error: `无写入权限：${path.dirname(current)}` }
  }
  const script = `#!/bin/bash
set -e
DST="$1"
SRC="$2"
sleep 1
cp -f "$SRC" "$DST"
chmod +x "$DST"
"$DST" &
`
  const scriptPath = path.join(os.tmpdir(), 'claude-pets-update', 'install.sh')
  fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  spawnDetached('/bin/bash', [scriptPath, current, appImagePath])
  quitSoon()
  return { ok: true }
}

function spawnDetached(cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

/** Give the IPC reply time to reach the renderer before quitting. */
function quitSoon(): void {
  setTimeout(() => app.quit(), 600)
}
