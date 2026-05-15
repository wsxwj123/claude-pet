/**
 * Build a file:// URL from a filesystem absolute path that works on
 * macOS, Linux AND Windows.
 *
 * - macOS/Linux:  /Users/me/file.png    →  file:///Users/me/file.png
 * - Windows:      C:\Users\me\file.png  →  file:///C:/Users/me/file.png
 *
 * The previous code did `file://${path}` which on Windows produced
 * `file://C:\Users\me\file.png` — Chromium silently fails to load that
 * (only 2 slashes, backslashes not URL-safe). Result: pet sprites
 * never render on Windows.
 */
export function toFileUrl(absPath: string): string {
  if (!absPath) return ''
  // Normalize backslashes to forward slashes.
  const normalized = absPath.replace(/\\/g, '/')
  // Windows: "C:/Users/..." needs the leading slash to become
  // "/C:/Users/...". POSIX paths already start with "/".
  const withLeadingSlash = normalized.startsWith('/')
    ? normalized
    : '/' + normalized
  // Percent-encode the few characters we know browsers reject in
  // file:// URLs. Spaces are the common one (e.g. user's home folder
  // has a space).
  const encoded = withLeadingSlash
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return 'file://' + encoded
}
