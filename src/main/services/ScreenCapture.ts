import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

/**
 * macOS screen capture via the built-in `screencapture` utility.
 *
 *   -x   silent (no shutter sound)
 *   -i   interactive (user drags a region; ESC cancels)
 *   -c   also write to the clipboard
 *
 * Both modes write to a temp PNG; we read it, base64 it, and delete it.
 * On user cancel during the interactive mode `screencapture` exits 0 and
 * leaves no file — we surface that as a `canceled` result.
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

export function captureScreen(mode: CaptureMode): Promise<CaptureResult> {
  if (process.platform !== 'darwin') {
    return Promise.resolve({ ok: false, reason: 'unsupported', error: 'macOS only for now' })
  }
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
        // Interactive mode: user can cancel with ESC — no file written.
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
