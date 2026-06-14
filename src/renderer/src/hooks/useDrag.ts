import { useCallback, useEffect, useRef } from 'react'
import type { AnimState } from './usePetAnimation'

const FRICTION = 0.88
const TICK_MS = 16
// Set very high so momentum effectively never triggers — pet stops
// exactly where the user releases. Lower this (e.g. 200) to bring back
// the fling/throw feel.
const MIN_VEL = 100000
const MAX_MOMENTUM_DURATION = 900
const SAMPLE_WINDOW_MS = 100
const CLICK_THRESHOLD_PX = 4
const CLICK_MAX_DURATION_MS = 300
const DIRECTION_THRESHOLD = 1.5
const DOUBLE_CLICK_MS = 320

interface DragOptions {
  onStateChange: (state: AnimState | null) => void
  onMove: (dx: number, dy: number) => void
  onClick?: () => void
  onDoubleClick?: () => void
}

interface Sample {
  x: number
  y: number
  t: number
}

export function useDrag(options: DragOptions): {
  onPointerDown: (e: React.PointerEvent) => void
  isDragging: () => boolean
} {
  const { onStateChange, onMove, onClick, onDoubleClick } = options
  const lastClickTime = useRef(0)
  const pendingClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dragging = useRef(false)
  const lastScreen = useRef({ x: 0, y: 0 })
  const totalMoved = useRef(0)
  const samples = useRef<Sample[]>([])
  const dragStartTime = useRef(0)
  const activePointerId = useRef<number | null>(null)
  const targetEl = useRef<HTMLElement | null>(null)
  const momentumTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const pushSample = (x: number, y: number): void => {
    const t = performance.now()
    samples.current.push({ x, y, t })
    samples.current = samples.current.filter((s) => t - s.t <= SAMPLE_WINDOW_MS)
  }

  const computeVelocity = (): { x: number; y: number } | null => {
    if (samples.current.length < 2) return null
    const last = samples.current[samples.current.length - 1]
    const first = samples.current.find((s) => last.t - s.t > 16)
    if (first == null) return null
    const dt = (last.t - first.t) / 1000
    if (dt <= 0) return null
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
  }

  const cancelMomentum = useCallback(() => {
    if (momentumTimer.current !== null) {
      clearTimeout(momentumTimer.current)
      momentumTimer.current = null
    }
  }, [])

  const throwWithVelocity = useCallback(
    (vx: number, vy: number) => {
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) return
      cancelMomentum()
      let elapsed = 0
      let cvx = vx
      let cvy = vy

      const tick = (): void => {
        momentumTimer.current = null
        elapsed += TICK_MS

        onMoveRef.current((cvx * TICK_MS) / 1000, (cvy * TICK_MS) / 1000)

        if (cvx >= MIN_VEL) onStateChange('running-right')
        else if (cvx <= -MIN_VEL) onStateChange('running-left')

        cvx *= FRICTION
        cvy *= FRICTION

        if (elapsed >= MAX_MOMENTUM_DURATION || Math.hypot(cvx, cvy) < MIN_VEL) {
          onStateChange(null)
          return
        }
        momentumTimer.current = setTimeout(tick, TICK_MS)
      }
      momentumTimer.current = setTimeout(tick, TICK_MS)
    },
    [cancelMomentum, onStateChange]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      cancelMomentum()

      const el = e.currentTarget as HTMLElement
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      dragging.current = true
      activePointerId.current = e.pointerId
      targetEl.current = el
      lastScreen.current = { x: e.screenX, y: e.screenY }
      totalMoved.current = 0
      samples.current = []
      pushSample(e.screenX, e.screenY)
      dragStartTime.current = Date.now()
    },
    [cancelMomentum]
  )

  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging.current) return
      if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return

      const dx = e.screenX - lastScreen.current.x
      const dy = e.screenY - lastScreen.current.y
      lastScreen.current = { x: e.screenX, y: e.screenY }
      totalMoved.current += Math.abs(dx) + Math.abs(dy)
      pushSample(e.screenX, e.screenY)

      if (totalMoved.current > CLICK_THRESHOLD_PX) {
        onMoveRef.current(dx, dy)
        if (dx >= DIRECTION_THRESHOLD) onStateChange('running-right')
        else if (dx <= -DIRECTION_THRESHOLD) onStateChange('running-left')
      }
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (!dragging.current) return
      if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return

      dragging.current = false
      const id = activePointerId.current
      activePointerId.current = null
      const el = targetEl.current
      targetEl.current = null

      if (el && id !== null) {
        try {
          el.releasePointerCapture(id)
        } catch {
          // ignore
        }
      }

      const dragDuration = Date.now() - dragStartTime.current

      if (totalMoved.current <= CLICK_THRESHOLD_PX && dragDuration <= CLICK_MAX_DURATION_MS) {
        onStateChange(null)
        const now = Date.now()
        const sincePrev = now - lastClickTime.current
        lastClickTime.current = now

        if (sincePrev <= DOUBLE_CLICK_MS && onDoubleClick) {
          // Cancel the pending single-click and fire double-click.
          if (pendingClickTimer.current) {
            clearTimeout(pendingClickTimer.current)
            pendingClickTimer.current = null
          }
          onDoubleClick()
          lastClickTime.current = 0
          return
        }

        // Defer single-click so a follow-up tap can upgrade to a double.
        if (onClick) {
          if (pendingClickTimer.current) clearTimeout(pendingClickTimer.current)
          pendingClickTimer.current = setTimeout(() => {
            pendingClickTimer.current = null
            onClick()
          }, onDoubleClick ? DOUBLE_CLICK_MS : 0)
        }
        return
      }

      const v = computeVelocity()
      if (v != null && Math.hypot(v.x, v.y) >= MIN_VEL) {
        throwWithVelocity(v.x, v.y)
      } else {
        onStateChange(null)
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      cancelMomentum()
      // Cancel a deferred single-click so it can't fire onClick (and
      // setState) after the component has unmounted.
      if (pendingClickTimer.current) {
        clearTimeout(pendingClickTimer.current)
        pendingClickTimer.current = null
      }
    }
  }, [onStateChange, onClick, onDoubleClick, throwWithVelocity, cancelMomentum])

  const isDraggingFn = useCallback(
    () => dragging.current || momentumTimer.current !== null,
    []
  )

  return { onPointerDown, isDragging: isDraggingFn }
}
