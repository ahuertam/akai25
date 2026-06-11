import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { midiToFrequency, getSynth } from '../audio/synth.js'

const STORAGE_KEY = 'akai25.recording.v1'

/** Lee eventos grabados persistidos en localStorage. Devuelve [] si falla. */
function loadPersistedEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.events)) return []
    // Validación mínima: cada evento debe tener los 4 campos numéricos.
    return parsed.events.filter((e) =>
      Number.isFinite(e.note) && Number.isFinite(e.startTime) &&
      Number.isFinite(e.duration) && Number.isFinite(e.velocity)
    )
  } catch {
    return []
  }
}

/**
 * Hook que gestiona la grabación y reproducción de una secuencia MIDI.
 *
 * Modelo de datos de cada evento grabado:
 *   { note: number, startTime: number, duration: number, velocity: number }
 *   - note:       número MIDI (0–127).
 *   - startTime:  segundos desde el inicio de la grabación.
 *   - duration:   segundos que la nota estuvo presionada (mínimo 0.05s).
 *   - velocity:   0–1, fuerza con la que se pulsó.
 *
 * Devuelve:
 *   - recordedEvents:      array con los eventos de la última grabación.
 *   - isRecording:         true mientras se está grabando.
 *   - isPlaying:           true mientras se está reproduciendo.
 *   - playbackActiveNotes: Set<number> con las notas sonando durante la
 *                          reproducción (combinar con activeNotes del MIDI
 *                          para iluminar el teclado virtual).
 *   - startRecording():    limpia la grabación y empieza a capturar.
 *   - stopRecording():     detiene la grabación (cierra notas colgadas).
 *   - playRecording():     reproduce la grabación con Tone.Transport.
 *   - stopPlayback():      detiene la reproducción.
 *   - clearRecording():    borra la grabación actual (y la persistida).
 *   - loadRecording(events): reemplaza la grabación actual con un array.
 *   - handleNoteOn(midi, velocity): suscriptor para Note On del hook MIDI.
 *   - handleNoteOff(midi):          suscriptor para Note Off del hook MIDI.
 */
export function useRecorder() {
  // Inicializamos desde localStorage para que la grabación sobreviva a recargas.
  const [recordedEvents, setRecordedEvents] = useState(loadPersistedEvents)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackActiveNotes, setPlaybackActiveNotes] = useState(new Set())

  // --- Estado mutable accesible desde callbacks sin re-suscribirse ---
  // Usamos refs para que handleNoteOn/Off siempre vean el estado actual
  // aunque React aún no haya confirmado el render del nuevo state.
  const isRecordingRef = useRef(false)
  const isPlayingRef = useRef(false)
  const recordingStartRef = useRef(0)        // Tone.now() al empezar a grabar
  const activeRecordingNotesRef = useRef(new Map()) // midi -> { startTime, velocity }
  const playbackEndTimeoutRef = useRef(null)

  // Mantenemos isPlayingRef sincronizado con el state (para callbacks).
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

  // --- Handlers de Note On / Off (suscriptores del hook MIDI) ---

  const handleNoteOn = useCallback((midi, velocity) => {
    if (!isRecordingRef.current) return
    activeRecordingNotesRef.current.set(midi, {
      startTime: Tone.now() - recordingStartRef.current,
      velocity,
    })
  }, [])

  const handleNoteOff = useCallback((midi) => {
    if (!isRecordingRef.current) return
    const data = activeRecordingNotesRef.current.get(midi)
    if (!data) return

    const endTime = Tone.now() - recordingStartRef.current
    const event = {
      note: midi,
      startTime: data.startTime,
      // duration mínima para que la nota sea audible en reproducción
      duration: Math.max(0.05, endTime - data.startTime),
      velocity: data.velocity,
    }
    setRecordedEvents((prev) => [...prev, event])
    activeRecordingNotesRef.current.delete(midi)
  }, [])

  // --- Controles de transporte ---

  const startRecording = useCallback(() => {
    // Si hay reproducción en curso, la paramos primero.
    if (isPlayingRef.current) {
      stopPlaybackInternal()
    }
    setRecordedEvents([])
    activeRecordingNotesRef.current.clear()
    recordingStartRef.current = Tone.now()
    isRecordingRef.current = true
    setIsRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return
    isRecordingRef.current = false
    setIsRecording(false)

    // Cerramos cualquier nota que se quedó colgada al detener.
    if (activeRecordingNotesRef.current.size > 0) {
      const endTime = Tone.now() - recordingStartRef.current
      const hanging = []
      for (const [midi, data] of activeRecordingNotesRef.current.entries()) {
        hanging.push({
          note: midi,
          startTime: data.startTime,
          duration: Math.max(0.05, endTime - data.startTime),
          velocity: data.velocity,
        })
      }
      setRecordedEvents((prev) => [...prev, ...hanging])
      activeRecordingNotesRef.current.clear()
    }
  }, [])

  // Detiene la reproducción sin exponerse en el contrato público
  // (se llama desde startRecording cuando hay playback activo).
  function stopPlaybackInternal() {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    Tone.getDraw().cancel(0)
    if (playbackEndTimeoutRef.current) {
      clearTimeout(playbackEndTimeoutRef.current)
      playbackEndTimeoutRef.current = null
    }
    isPlayingRef.current = false
    setIsPlaying(false)
    setPlaybackActiveNotes(new Set())
  }

  const stopPlayback = useCallback(() => {
    stopPlaybackInternal()
  }, [])

  const playRecording = useCallback(() => {
    if (isPlayingRef.current) return
    if (recordedEvents.length === 0) return

    const transport = Tone.getTransport()
    const draw = Tone.getDraw()

    // Limpiamos cualquier schedule previo.
    transport.stop()
    transport.cancel(0)
    draw.cancel(0)
    transport.position = 0

    // Programamos audio y visual de cada evento en el Transport.
    for (const event of recordedEvents) {
      const freq = midiToFrequency(event.note)

      // Audio: el callback recibe el tiempo exacto del AudioContext.
      transport.schedule((time) => {
        const currentSynth = getSynth()
        if (currentSynth) {
          currentSynth.triggerAttackRelease(freq, event.duration, time, event.velocity)
        }
      }, event.startTime)

      // Visual: Tone.Draw se sincroniza con requestAnimationFrame, así que
      // las teclas se encienden/apagan alineadas con el audio que sale
      // por los altavoces (compensa el retardo del AudioContext).
      draw.schedule(() => {
        setPlaybackActiveNotes((prev) => {
          const next = new Set(prev)
          next.add(event.note)
          return next
        })
      }, event.startTime)

      draw.schedule(() => {
        setPlaybackActiveNotes((prev) => {
          if (!prev.has(event.note)) return prev
          const next = new Set(prev)
          next.delete(event.note)
          return next
        })
      }, event.startTime + event.duration)
    }

    const totalDuration = recordedEvents.reduce(
      (max, e) => Math.max(max, e.startTime + e.duration),
      0,
    )

    isPlayingRef.current = true
    setIsPlaying(true)
    transport.start()

    // Cuando termina la última nota, limpiamos el flag isPlaying.
    playbackEndTimeoutRef.current = setTimeout(() => {
      isPlayingRef.current = false
      setIsPlaying(false)
      setPlaybackActiveNotes(new Set())
      playbackEndTimeoutRef.current = null
    }, (totalDuration + 0.2) * 1000)
  }, [recordedEvents])

  // Limpieza al desmontar: cancelamos schedules y timeouts.
  useEffect(() => {
    return () => {
      Tone.getTransport().stop()
      Tone.getTransport().cancel(0)
      Tone.getDraw().cancel(0)
      if (playbackEndTimeoutRef.current) {
        clearTimeout(playbackEndTimeoutRef.current)
      }
    }
  }, [])

  // Persistencia automática: cada cambio en recordedEvents se guarda en
  // localStorage para que la grabación sobreviva a recargas.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, events: recordedEvents }),
      )
    } catch {
      // localStorage lleno o no disponible → ignorar.
    }
  }, [recordedEvents])

  /** Borra la grabación (memoria + localStorage). Detiene playback si activo. */
  const clearRecording = useCallback(() => {
    if (isPlayingRef.current) stopPlaybackInternal()
    setRecordedEvents([])
  }, [])

  /** Reemplaza la grabación actual (usado al cargar un .json). */
  const loadRecording = useCallback((events) => {
    if (isPlayingRef.current) stopPlaybackInternal()
    if (!Array.isArray(events)) return
    setRecordedEvents(events)
  }, [])

  return {
    recordedEvents,
    isRecording,
    isPlaying,
    playbackActiveNotes,
    startRecording,
    stopRecording,
    playRecording,
    stopPlayback,
    clearRecording,
    loadRecording,
    handleNoteOn,
    handleNoteOff,
  }
}
