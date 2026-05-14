import { useEffect, useRef, useState } from 'react'
import type { AnimState } from '../../../shared/types'

export type { AnimState }

// Spritesheet: 1536x1872, 8 cols × 9 rows, 192×208px per cell
const COLS = 8
const ROWS = 9

const STATE_ROW: Record<AnimState, number> = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8
}

const FRAME_COUNTS: Record<AnimState, number> = {
  idle: 6,
  'running-right': 8,
  'running-left': 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6
}

// ms per frame for each state
const FRAME_MS: Record<AnimState, number> = {
  idle: 150,
  'running-right': 80,
  'running-left': 80,
  waving: 120,
  jumping: 100,
  failed: 120,
  waiting: 150,
  running: 80,
  review: 120
}

export interface SpriteStyle {
  backgroundSize: string
  backgroundPosition: string
}

export function usePetAnimation(state: AnimState): SpriteStyle {
  const [frame, setFrame] = useState(0)
  const frameRef = useRef(frame)
  const stateRef = useRef(state)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset frame when state changes
  useEffect(() => {
    stateRef.current = state
    frameRef.current = 0
    setFrame(0)
  }, [state])

  useEffect(() => {
    function tick(): void {
      const currentState = stateRef.current
      const count = FRAME_COUNTS[currentState]
      const nextFrame = (frameRef.current + 1) % count
      frameRef.current = nextFrame
      setFrame(nextFrame)
      timerRef.current = setTimeout(tick, FRAME_MS[currentState])
    }

    timerRef.current = setTimeout(tick, FRAME_MS[state])
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [state])

  const row = STATE_ROW[state]
  const col = frame

  // backgroundSize: scale spritesheet so one cell fills the element
  const bgSizeX = COLS * 100
  const bgSizeY = ROWS * 100

  // backgroundPosition: position the correct cell
  // col / (COLS-1) * 100%, row / (ROWS-1) * 100%
  const bgPosX = COLS <= 1 ? 0 : (col / (COLS - 1)) * 100
  const bgPosY = ROWS <= 1 ? 0 : (row / (ROWS - 1)) * 100

  return {
    backgroundSize: `${bgSizeX}% ${bgSizeY}%`,
    backgroundPosition: `${bgPosX}% ${bgPosY}%`
  }
}
