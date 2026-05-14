import React from 'react'

/**
 * Tiny inline-SVG icon set. We deliberately keep this in-source rather
 * than pulling lucide-react / heroicons to:
 *
 *   1. Avoid an extra dependency for ~15 icons
 *   2. Get exact pixel control over the menu's 14×14 grid
 *   3. Match the line-weight (1.6px) and corner radius we use elsewhere
 *
 * Paths are drawn from Lucide (https://lucide.dev, ISC). When a new icon
 * is needed: visit lucide.dev, copy the `<path>` data, paste a new
 * branch here.
 *
 * All paths assume a 24-unit viewBox and currentColor stroke. The
 * wrapper scales the SVG to the requested `size` (default 14).
 */

export type IconName =
  | 'chat'
  | 'history'
  | 'camera'
  | 'cpu'
  | 'paw'
  | 'maximize'
  | 'settings'
  | 'eye-off'
  | 'mic'
  | 'mic-recording'
  | 'mic-loading'
  | 'keyboard'
  | 'plug'
  | 'info'
  | 'pin'
  | 'scissors'
  | 'monitor'
  | 'refresh'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'circle'
  | 'x'
  | 'plus'

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
}

const PATHS: Record<IconName, React.ReactNode> = {
  // Speech bubble (rounded square with corner notch)
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  // Clock + counterclockwise (history)
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  // Stylized cpu / chip — represents agent/model
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </>
  ),
  // Paw print
  paw: (
    <>
      <circle cx="11" cy="4" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="20" cy="16" r="2" />
      <circle cx="4" cy="8" r="2" />
      <path d="M9 10c-2.5 0-4 2.5-4 4.5 0 2 1.5 3.5 4 3.5h6c2.5 0 4-1.5 4-3.5 0-2-1.5-4.5-4-4.5h-6z" />
    </>
  ),
  // Maximize / size (4 corners)
  maximize: (
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  ),
  // Gear
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  'eye-off': (
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
  ),
  mic: (
    <>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
    </>
  ),
  'mic-recording': (
    <>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </>
  ),
  'mic-loading': (
    <>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4" />
    </>
  ),
  plug: (
    <path d="M9 2v6M15 2v6M6 12h12l-1 8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 12zM7 12V8h10v4" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  pin: (
    <path d="M12 17v5M9 7l-2 7h10l-2-7M9 7V2h6v5" />
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  circle: <circle cx="12" cy="12" r="9" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 14,
  strokeWidth = 1.75,
  className,
  style
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
