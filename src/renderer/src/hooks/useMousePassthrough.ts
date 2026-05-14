import { useEffect, useRef } from 'react'

/**
 * Manages mouse passthrough for the transparent pet window.
 *
 * Always hit-tests with elementFromPoint and flips passthrough off only
 * when the pointer is over a [data-interactive] element. This keeps
 * transparent regions transparent to clicks — important for coexisting
 * with floating apps like Bob, Raycast, PopClip, etc. that may sit
 * underneath our always-on-top overlay.
 *
 * Drag in progress: keep passthrough off so pointer capture is preserved.
 */
export function useMousePassthrough(isDragging: () => boolean): void {
  const ignoring = useRef(true)

  useEffect(() => {
    const setIgnore = (value: boolean): void => {
      if (ignoring.current === value) return
      ignoring.current = value
      window.petAPI.setIgnoreMouseEvents(value)
    }

    const handler = (e: MouseEvent): void => {
      if (isDragging()) {
        setIgnore(false)
        return
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const interactive = el && (el as HTMLElement).closest('[data-interactive]')
      setIgnore(!interactive)
    }

    window.addEventListener('mousemove', handler)
    return () => {
      window.removeEventListener('mousemove', handler)
    }
  }, [isDragging])
}
