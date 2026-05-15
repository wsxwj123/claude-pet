import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { desktopCapturer, screen, clipboard, nativeImage } from 'electron'

/**
 * Cross-platform screen capture.
 *
 *   macOS:   native /usr/sbin/screencapture (fastest, supports region select)
 *   Windows: full → Electron desktopCapturer
 *            region → launches Windows Snipping Tool (ms-screenclip:), then
 *                     polls the clipboard for the image
 *   Linux:   full → Electron desktopCapturer
 *            region → not supported yet; tells user to use system snipping
 *                     tool + Cmd+V paste into chat
 */

export type CaptureMode = 'full' | 'region'

export interface CaptureResult {
  ok: boolean
  base64?: string
  mediaType?: 'image/png'
  reason?: 'canceled' | 'error' | 'unsupported'
  error?: string
}

const TMP_DIR = path.join(os.tmpdir(), 'claude-pets-screenshots')

function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
}

// ────────────────────────────────────────────────────────────────────
// macOS: native screencapture
// ────────────────────────────────────────────────────────────────────

function captureMac(mode: CaptureMode): Promise<CaptureResult> {
  ensureTmpDir()
  const file = path.join(TMP_DIR, `cap-${crypto.randomBytes(4).toString('hex')}.png`)
  const args = mode === 'region' ? ['-x', '-i', '-c', file] : ['-x', '-c', file]

  return new Promise((resolve) => {
    const proc = spawn('/usr/sbin/screencapture', args, { stdio: 'ignore' })
    proc.on('error', (err) =>
      resolve({ ok: false, reason: 'error', error: err.message })
    )
    proc.on('exit', (code) => {
      const safeUnlink = (): void => {
        try {
          fs.unlinkSync(file)
        } catch {
          /* ignore — file may not exist (cancel) */
        }
      }
      try {
        if (code !== 0) {
          resolve({ ok: false, reason: 'error', error: `screencapture exit ${code}` })
          return
        }
        if (!fs.existsSync(file)) {
          resolve({ ok: false, reason: 'canceled' })
          return
        }
        const buf = fs.readFileSync(file)
        resolve({
          ok: true,
          base64: buf.toString('base64'),
          mediaType: 'image/png'
        })
      } catch (err) {
        resolve({
          ok: false,
          reason: 'error',
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        safeUnlink()
      }
    })
  })
}

// ────────────────────────────────────────────────────────────────────
// Cross-platform: Electron desktopCapturer (full screen only)
// ────────────────────────────────────────────────────────────────────

async function captureFullViaElectron(): Promise<CaptureResult> {
  try {
    const primary = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primary.size.width * primary.scaleFactor,
        height: primary.size.height * primary.scaleFactor
      }
    })
    if (sources.length === 0) {
      return { ok: false, reason: 'error', error: 'no screen sources available' }
    }
    const thumb = sources[0].thumbnail
    if (thumb.isEmpty()) {
      return { ok: false, reason: 'error', error: 'empty screen thumbnail' }
    }
    return {
      ok: true,
      base64: thumb.toPNG().toString('base64'),
      mediaType: 'image/png'
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Windows: native Snipping Tool via ms-screenclip URL + clipboard poll
// ────────────────────────────────────────────────────────────────────

async function captureRegionWindows(): Promise<CaptureResult> {
  // Snapshot clipboard image hash BEFORE launching so we can tell when
  // the user has actually captured something new (vs the clipboard
  // already containing some image).
  const beforeImg = clipboard.readImage()
  const beforeKey = beforeImg.isEmpty() ? '' : beforeImg.toBitmap().toString('base64').slice(0, 64)

  // ms-screenclip: opens Windows 10/11's modern snipping tool with
  // region select active by default. After user drags a region and
  // releases, the image lands on the clipboard.
  spawn('cmd.exe', ['/c', 'start', '', 'ms-screenclip:'], {
    detached: true,
    stdio: 'ignore'
  }).on('error', () => undefined)

  // Poll clipboard every 200ms for up to 30s for a new image.
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    await new Promise((r) => setTimeout(r, 200))
    const img = clipboard.readImage()
    if (img.isEmpty()) continue
    const key = img.toBitmap().toString('base64').slice(0, 64)
    if (key === beforeKey) continue
    // Got new image
    return {
      ok: true,
      base64: img.toPNG().toString('base64'),
      mediaType: 'image/png'
    }
  }
  return {
    ok: false,
    reason: 'canceled',
    error: 'no screenshot captured within 30s'
  }
}

// ────────────────────────────────────────────────────────────────────
// Linux region — not auto-implemented; tell user how
// ────────────────────────────────────────────────────────────────────

function captureRegionLinuxHint(): CaptureResult {
  return {
    ok: false,
    reason: 'unsupported',
    error:
      'Linux 区域截图尚未集成。请用系统截图工具（GNOME Screenshot / Flameshot / Spectacle）截图，然后在 chat 输入框 Ctrl+V 粘贴。'
  }
}

// ────────────────────────────────────────────────────────────────────
// Top-level dispatcher
// ────────────────────────────────────────────────────────────────────

export function captureScreen(mode: CaptureMode): Promise<CaptureResult> {
  if (process.platform === 'darwin') return captureMac(mode)

  if (mode === 'full') return captureFullViaElectron()

  // region mode on non-mac
  if (process.platform === 'win32') return captureRegionWindows()

  // Avoid unused import warnings on macOS / Windows.
  void nativeImage
  return Promise.resolve(captureRegionLinuxHint())
}
