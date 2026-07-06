import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  AVAILABLE_INSTRUMENTS,
  createTrack,
  setTrackInstrument,
  setTrackMuted,
  silenceTrack,
  triggerTrackNote,
  releaseTrackNote,
  playTrackNoteScheduled,
  createInstrumentInstance,
} from '../audio/synth.js'
import { audioBufferToWav } from '../utils/wavEncoder.js'

// 8 pistas por defecto. 2 compases de loop = 8 negras = (60/bpm)*8 s.
// Instrumentos iniciales pensados para tener un kit heterogéneo de
// salida: drums + bass + armonía + lead.
const NUM_TRACKS = 8
const LOOP_BEATS = 8
const DEFAULT_INSTRUMENTS = ['drums', 'bass', 'piano', 'lead', 'pad', 'pluck', 'fm', 'synth']
// Heurística para "loop lleno" en pistas con overwrite=false: 200
// eventos es ~4.8s a 40 notas/s, suficiente para una idea musical densa.
const MAX_EVENTS_PER_TRACK = 200
// Mapa de colores por pista. Mantenido aquí (no en CSS) porque es
// metadata de presentación y queremos que cada fila sepa su color.
const TRACK_COLORS = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b',
  '#51cf66', '#22d3ee', '#6ee7ff', '#aa3bff',
]

/**
 * Hook que orquesta el modo creative: 8 pistas simultáneas con
 * instrumentos propios, playhead que recorre un loop fijo de 2 compases,
 * y un `Tone.Part` por pista que reproduce sus eventos en bucle.
 *
 * Decisiones de diseño que el ponytail me hizo evitar abstraer:
 *  - Sin Tone.Sequence / Tone.Loop / Tone.Player nuevos: con un Part por
 *    pista + Transport.loop basta, igual que hace useRecorder.
 *  - Sin clase Track propia: cada pista es un objeto literal en useState.
 *  - Sin Tone.Recorder: el creative graba MIDI events (no audio).
 *
 * Modelo de overwrite (decidido con el usuario):
 *  - overwrite=true (default): al cruzar el final del loop, los eventos
 *    previos del track se vacían antes de aceptar nuevos. Estilo MPC.
 *  - overwrite=false: los eventos se acumulan; al llegar a MAX_EVENTS
 *    se ignoran notas nuevas hasta hacer clearTrack.
 */
export function useCreativeMode({ bpm = 100 } = {}) {
  const loopLength = (60 / bpm) * LOOP_BEATS

  // Estado reactivo. Cada cambio re-renderiza el componente creative y
  // dispara el useEffect de sincronización (Part ↔ events).
  //
  // overwrite = false por defecto: los eventos grabados PERSISTEN entre
  // vueltas del playhead (el usuario puede ir construyendo el patrón
  // loop a loop). Con overwrite = true se vuelve al estilo MPC: el track
  // se vacía en cada wrap y solo sobrevive lo grabado en la última vuelta.
  const [tracks, setTracks] = useState(() =>
    Array.from({ length: NUM_TRACKS }, (_, i) => ({
      id: i,
      instrumentId: DEFAULT_INSTRUMENTS[i % DEFAULT_INSTRUMENTS.length],
      events: [],
      overwrite: false,
      muted: false,
      color: TRACK_COLORS[i],
    })),
  )
  const [activeTrackId, setActiveTrackId] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playheadTime, setPlayheadTime] = useState(0)

  // Refs para estado no-reactivo (instancias de Tone, ids de scheduling).
  const partsRef = useRef(new Map())      // trackId → Tone.Part
  const drawIdRef = useRef(null)          // id de Tone.Draw para el playhead
  const loopCallbackIdRef = useRef(null)  // id de Transport.scheduleRepeat
  const transportRef = useRef(null)
  // Latest-ref de `tracks`: lo mantienen los useEffect de abajo, no el
  // render, para evitar el warning de react-hooks/refs.
  const tracksRef = useRef(tracks)

  // -------------------------------------------------------------------
  // Boot: crea los tracks de audio, configura el Transport y registra
  // el callback de overwrite en cada wrap del loop.
  // -------------------------------------------------------------------
  useEffect(() => {
    const transport = Tone.getTransport()
    transportRef.current = transport
    transport.bpm.value = bpm
    transport.loop = true
    transport.loopStart = 0
    transport.loopEnd = loopLength
    transport.seconds = 0

    // Crea los 8 tracks de audio (instancias Tone.js) con sus instrumentos.
    tracks.forEach((track) => {
      createTrack(track.id, track.instrumentId)
    })

    // Callback que se dispara cada vez que el playhead cruza el final
    // del loop. Procesa el overwrite de todas las pistas en un solo
    // setTracks (un solo re-render).
    const loopId = transport.scheduleRepeat(() => {
      setTracks((prev) =>
        prev.map((t) => (t.overwrite ? { ...t, events: [] } : t)),
      )
    }, loopLength)
    loopCallbackIdRef.current = loopId

    return () => {
      // ponytail: leemos las refs en el cleanup a propósito — queremos
      // disponer el estado ACTUAL, no una captura al montar. La regla
      // react-hooks/refs asume refs a nodos React, no aplica aquí.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const parts = partsRef.current
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const tracksAtCleanup = tracksRef.current
      const drawId = drawIdRef.current
      if (drawId !== null) {
        // rAF id (Tone.Draw cancel estaba mal aquí: cancel(time) borra
        // eventos posteriores al tiempo; drawId era el id de un solo
        // frame, no un timestamp).
        cancelAnimationFrame(drawId)
        drawIdRef.current = null
      }
      transport.clear(loopId)
      transport.loop = false
      transport.stop()
      parts.forEach((part) => part.dispose())
      parts.clear()
      tracksAtCleanup.forEach((t) => {
        silenceTrack(t.id)
        // removeTrack no está exportado en este hook; el dispose de
        // App.jsx al desmontar se hace por la singleton vía silencio.
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------
  // Sincroniza los Tone.Parts con los `events` cada vez que cambian.
  // Sin esto, los rectángulos se verían en la UI pero el audio no
  // reproduciría nada.
  // -------------------------------------------------------------------
  useEffect(() => {
    tracks.forEach((track) => {
      let part = partsRef.current.get(track.id)
      if (!part) {
        part = new Tone.Part((time, value) => {
          playTrackNoteScheduled(value.trackId, value.note, value.duration, time, value.velocity)
        }, [])
        part.loop = true
        part.loopEnd = loopLength
        partsRef.current.set(track.id, part)
      }
      part.clear()
      // Convertimos los events del state a la estructura [time, value]
      // que espera Tone.Part. `localTime` está en segundos dentro del
      // loop; Part.loop + loopEnd se encarga de repetirlo.
      const partEvents = track.events.map((e) => [
        e.localTime,
        { trackId: track.id, note: e.note, velocity: e.velocity, duration: e.duration },
      ])
      // ponytail: Part.add() NO itera arrays — solo maneja eventos
      // individuales. El constructor sí los itera, pero add() no. Si
      // llamamos part.add(array) crea UN ToneEvent con value=undefined
      // (el array no tiene prop `time`) en vez de uno por par. Por eso
      // nunca sonaban los eventos del modo creative. Iteramos nosotros.
      // Saltamos la llamada si no hay eventos para no meter un ToneEvent
      // fantasma con value=undefined en _events.
      if (partEvents.length > 0) {
        partEvents.forEach(([localTime, value]) => {
          part.add(localTime, value)
        })
      }
      // ponytail: NO llamar part.start(0) aquí. El callback `start()` ya
      // arrancó los parts en '+0.05', 0; reiniciarlos ahora con `0` falla
      // porque 0 está en el pasado relativo al último scheduled time del
      // Transport ("must be >= last scheduled time"). Solo paramos cuando
      // isPlaying cae a false; el start lo gestiona el callback.
      if (!isPlaying) {
        // ponytail: part.stop() sin argumento provoca RangeError en
        // StateTimeline.setStateAtTime ("Value must be within [0, Infinity],
        // got: -1.4e-13") porque al pasar undefined a toTicks(), la
        // conversión termina dando un valor ligeramente negativo por
        // floating-point. Pasamos el tiempo explícito del Transport y
        // clampeamos por si transport.seconds viene ligeramente < 0
        // (puede pasar justo después de transport.seconds = 0 si la
        // conversión a ticks redondea por debajo).
        const transportTime = transportRef.current?.seconds ?? 0
        part.stop(Math.max(0, transportTime))
      }
    })
  }, [tracks, isPlaying, loopLength])

  // -------------------------------------------------------------------
  // Transport: arrancar / parar el playhead y los Parts.
  // -------------------------------------------------------------------
  const start = useCallback(() => {
    const transport = transportRef.current
    if (!transport) return
    transport.seconds = 0
    transport.start('+0.05', 0)
    partsRef.current.forEach((part) => part.start('+0.05', 0))
    // ponytail: Tone.Draw.schedule es ONE-SHOT (mira Draw.js: encola en
    // _events, _drawLoop ejecuta UNA vez y la borra). Para que el
    // playhead se mueva continuamente hay que re-programarse en cada
    // frame. requestAnimationFrame va bien — no necesitamos la sincronía
    // con el AudioContext porque leemos transport.seconds, no time.
    if (drawIdRef.current === null) {
      const tick = () => {
        // Clamp defensivo: cuando transport.seconds == loopLength el
        // módulo puede devolver -1.4e-13 por coma flotante (lo vimos
        // con part.stop). Forzamos el rango para que el render CSS no
        // reciba un porcentaje negativo o >100%.
        const raw = transport.seconds % loopLength
        const t = raw < 0 ? 0 : raw > loopLength ? loopLength : raw
        setPlayheadTime(t)
        drawIdRef.current = requestAnimationFrame(tick)
      }
      drawIdRef.current = requestAnimationFrame(tick)
    }
    setIsPlaying(true)
  }, [loopLength])

  const stop = useCallback(() => {
    const transport = transportRef.current
    if (!transport) return
    transport.stop()
    transport.seconds = 0
    // Mismo motivo que en el sync effect: pasamos tiempo explícito para
    // evitar el RangeError de StateTimeline.setStateAtTime.
    partsRef.current.forEach((part) => part.stop(0))
    if (drawIdRef.current !== null) {
      cancelAnimationFrame(drawIdRef.current)
      drawIdRef.current = null
    }
    setIsPlaying(false)
    setPlayheadTime(0)
  }, [])

  // -------------------------------------------------------------------
  // Grabación: añade el evento al track activo con localTime = posición
  // actual del playhead. Si overwrite=false y el track está lleno,
  // ignora la nota (excepto para live playback, que sigue sonando).
  // -------------------------------------------------------------------
  const recordEvent = useCallback(({ note, velocity = 0.8, duration = 0.3 } = {}) => {
    if (note === undefined || note === null) return
    const transport = transportRef.current
    const localTime = transport ? transport.seconds % loopLength : 0

    // Live: la nota suena siempre que el playhead esté corriendo o no.
    // Esto da feedback inmediato al usuario aunque esté en modo "stop".
    triggerTrackNote(activeTrackId, note, velocity)

    // Captura: solo si el playhead está corriendo (sentido MPC).
    if (!isPlaying) return
    setTracks((prev) =>
      prev.map((track) => {
        if (track.id !== activeTrackId) return track
        if (!track.overwrite && track.events.length >= MAX_EVENTS_PER_TRACK) return track
        return {
          ...track,
          events: [
            ...track.events,
            { note, velocity, duration, localTime },
          ],
        }
      }),
    )
  }, [activeTrackId, isPlaying, loopLength])

  // -------------------------------------------------------------------
  // Acciones sobre tracks. Cada una actualiza state + audio engine.
  // -------------------------------------------------------------------
  const setActiveTrack = useCallback((trackId) => {
    setActiveTrackId(trackId)
  }, [])

  const setInstrument = useCallback((trackId, instrumentId) => {
    if (!AVAILABLE_INSTRUMENTS.some((i) => i.id === instrumentId)) return
    setTrackInstrument(trackId, instrumentId)
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, instrumentId } : t)),
    )
  }, [])

  const toggleOverwrite = useCallback((trackId) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, overwrite: !t.overwrite } : t)),
    )
  }, [])

  const toggleMute = useCallback((trackId) => {
    setTracks((prev) => {
      const next = prev.map((t) => {
        if (t.id !== trackId) return t
        const muted = !t.muted
        setTrackMuted(trackId, muted)
        return { ...t, muted }
      })
      return next
    })
  }, [])

  const clearTrack = useCallback((trackId) => {
    silenceTrack(trackId)
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, events: [] } : t)),
    )
  }, [])

  const clearAll = useCallback(() => {
    tracksRef.current.forEach((t) => silenceTrack(t.id))
    setTracks((prev) => prev.map((t) => ({ ...t, events: [] })))
  }, [])

  // Borra un único evento del track (doble-click sobre el rectángulo en
  // la UI). Filtramos por índice; los rectángulos usan el índice como
  // key de React, así que este índice es estable hasta el próximo render
  // — el doble-click lo captura antes de que React re-renderice.
  const deleteEvent = useCallback((trackId, eventIndex) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? { ...t, events: t.events.filter((_, i) => i !== eventIndex) }
          : t
      )
    )
  }, [])

  // -------------------------------------------------------------------
  // Export: render offline del loop a WAV + descarga. Usa Tone.Offline
  // (un AudioContext efímero que renderiza offline) porque el contexto
  // live no nos deja extraer el buffer directamente. Los efectos master
  // (masterFilter, masterReverb) son del contexto live y no se
  // incluyen en el export — pequeño compromiso a cambio de no tener
  // que re-instanciar el bus entero dentro del callback.
  // -------------------------------------------------------------------
  const [isExporting, setIsExporting] = useState(false)
  const exportSong = useCallback(async () => {
    if (isExporting) return
    const hasEvents = tracksRef.current.some((t) => t.events.length > 0)
    if (!hasEvents) return

    setIsExporting(true)
    try {
      // Leemos desde el ref para no depender del state de React (puede
      // haber un setTracks en vuelo que aún no se ha confirmado).
      const currentTracks = tracksRef.current

      // Pequeño margen al final para que el release de las últimas notas
      // no se corte (los envelopes tardan en decaer).
      const renderDuration = loopLength + 0.5

      const buffer = await Tone.Offline(({ transport }) => {
        transport.bpm.value = bpm

        currentTracks.forEach((track) => {
          if (track.events.length === 0 || track.muted) return
          const synth = createInstrumentInstance(track.instrumentId)
          // Conectamos al destino del OfflineContext (no al masterFilter
          // del contexto live, que no existe aquí).
          synth.toDestination()

          track.events.forEach((event) => {
            // Para NoiseSynth el primer arg es duración (no nota).
            if (synth instanceof Tone.NoiseSynth) {
              synth.triggerAttackRelease(event.duration, event.localTime, event.velocity)
            } else {
              const freq = 440 * Math.pow(2, (event.note - 69) / 12)
              synth.triggerAttackRelease(freq, event.duration, event.localTime, event.velocity)
            }
          })
        })

        transport.start()
      }, renderDuration)

      const audioBuffer = buffer.get()
      const wav = audioBufferToWav(audioBuffer)
      const blob = new Blob([wav], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `akai25-creative-${Date.now()}.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      // No rompemos la app si falla el render offline; avisamos por consola.
      console.error('Export falló:', err)
    } finally {
      setIsExporting(false)
    }
  }, [bpm, loopLength, isExporting])

  return {
    tracks,
    activeTrackId,
    setActiveTrack,
    isPlaying,
    playheadTime,
    loopLength,
    numTracks: NUM_TRACKS,
    setInstrument,
    toggleOverwrite,
    toggleMute,
    clearTrack,
    clearAll,
    deleteEvent,
    start,
    stop,
    recordEvent,
    releaseNote: (midi) => releaseTrackNote(activeTrackId, midi),
    availableInstruments: AVAILABLE_INSTRUMENTS,
    exportSong,
    isExporting,
  }
}