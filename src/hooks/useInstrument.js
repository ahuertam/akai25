import { useCallback, useEffect, useState } from 'react'
import {
  AVAILABLE_INSTRUMENTS,
  getCurrentInstrumentName,
  setInstrument as setSynthInstrument,
} from '../audio/synth.js'

const STORAGE_KEY = 'akai25.instrument'

/**
 * Lee el instrumento persistido en localStorage (si existe) y devuelve su id.
 * Si no, devuelve el instrumento activo al cargar el módulo de audio.
 */
function readPersistedInstrument() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && AVAILABLE_INSTRUMENTS.some((i) => i.id === stored)) {
      return stored
    }
  } catch {
    // localStorage no disponible (modo privado, SSR, etc.) → fallback.
  }
  return getCurrentInstrumentName() ?? AVAILABLE_INSTRUMENTS[0].id
}

/**
 * Hook que gestiona el instrumento activo. Sincroniza el módulo de audio
 * (cambiando el sintetizador en caliente) y persiste la selección en
 * localStorage para restaurarla en recargas futuras.
 */
export function useInstrument() {
  const [instrumentId, setInstrumentId] = useState(readPersistedInstrument)

  // Aplica la selección al módulo de audio.
  useEffect(() => {
    setSynthInstrument(instrumentId)
  }, [instrumentId])

  // Persiste en localStorage cada vez que cambia.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, instrumentId)
    } catch {
      // Ignorar errores de localStorage.
    }
  }, [instrumentId])

  const setInstrument = useCallback((id) => {
    if (!AVAILABLE_INSTRUMENTS.some((i) => i.id === id)) return
    setInstrumentId(id)
  }, [])

  return { instrumentId, setInstrument, available: AVAILABLE_INSTRUMENTS }
}
