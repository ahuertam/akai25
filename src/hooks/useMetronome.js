import { useCallback, useEffect, useRef, useState } from 'react'
import { startMetronome, stopMetronome } from '../audio/metronome.js'

const MIN_BPM = 40
const MAX_BPM = 240
const DEFAULT_BPM = 100
// Duración del "flash" visual tras cada tick (en ms). Pequeña para que se
// sienta como un pulso y no como un estado sostenido.
const TICK_FLASH_MS = 70

/**
 * Hook que gestiona el estado del metrónomo: activado/desactivado, BPM y
 * un pulso visual (`isTicking`) que se enciende brevemente en cada tick
 * para alimentar la UI.
 */
export function useMetronome() {
  const [isEnabled, setIsEnabled] = useState(false)
  const [bpm, setBpmState] = useState(DEFAULT_BPM)
  const [isTicking, setIsTicking] = useState(false)

  // Timer para apagar el pulso visual tras TICK_FLASH_MS.
  const flashTimerRef = useRef(null)

  const handleTick = useCallback(() => {
    setIsTicking(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      setIsTicking(false)
      flashTimerRef.current = null
    }, TICK_FLASH_MS)
  }, [])

  // Sincroniza el audio del metrónomo con el estado React.
  useEffect(() => {
    if (isEnabled) {
      startMetronome(bpm, handleTick)
    } else {
      stopMetronome()
    }
    return () => {
      stopMetronome()
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current)
        flashTimerRef.current = null
      }
    }
  }, [isEnabled, bpm, handleTick])

  const setBpm = useCallback((newBpm) => {
    const n = Number(newBpm)
    if (!Number.isFinite(n)) return
    const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(n)))
    setBpmState(clamped)
  }, [])

  const toggle = useCallback(() => {
    setIsEnabled((prev) => !prev)
  }, [])

  return {
    isEnabled,
    bpm,
    isTicking,
    minBpm: MIN_BPM,
    maxBpm: MAX_BPM,
    setBpm,
    toggle,
  }
}
