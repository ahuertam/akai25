import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useCreativeMode } from '../hooks/useCreativeMode.js'
import { useMetronome } from '../hooks/useMetronome.js'
import { Keyboard } from './Keyboard.jsx'
import { CreativeHeader } from './CreativeHeader.jsx'
import { CreativeTrack } from './CreativeTrack.jsx'
import { CreativeEventEditor } from './CreativeEventEditor.jsx'

/**
 * Vista completa del modo creative. Orquesta:
 *  - Hook `useCreativeMode` (estado + scheduling de las 8 pistas).
 *  - `useMetronome` para heredar el BPM global (la app ya lo tiene).
 *  - Teclado en pantalla que dispara notas sobre la pista activa.
 *
 * Props:
 *  - onExit: callback para volver a la vista normal.
 *  - activeNotes: Set<number> con las notas activas del MIDI físico
 *    (para iluminar las teclas del teclado en pantalla).
 *  - midiHandlerRef: ref que App.jsx consulta para rutear MIDI del Akai
 *    según el modo (normal → recorder, creative → pista activa).
 */
export function CreativeMode({ onExit, activeNotes, midiHandlerRef }) {
  const metronome = useMetronome()
  const creative = useCreativeMode({ bpm: metronome.bpm })

  // El teclado en pantalla y el MIDI físico pasan por aquí: el note-on
  // hace live sound + capture (si el playhead corre), el note-off libera
  // la nota del synth de la pista activa.
  const handleKeyDown = useCallback(
    (midi) => {
      creative.recordEvent({ note: midi, velocity: 0.8, duration: 0.4 })
    },
    [creative],
  )
  const handleKeyUp = useCallback(
    (midi) => {
      creative.releaseNote(midi)
    },
    [creative],
  )

  // Publica los handlers de MIDI en el ref del padre para que el router
  // de App.jsx pueda rutear al creativo en lugar de al recorder.
  // En cleanup los desreferenciamos para que el MIDI regrese al recorder.
  useEffect(() => {
    midiHandlerRef.current = {
      onNoteOn: (midi, velocity) =>
        creative.recordEvent({ note: midi, velocity, duration: 0.4 }),
      onNoteOff: (midi) => creative.releaseNote(midi),
    }
    return () => {
      midiHandlerRef.current = null
    }
  }, [creative, midiHandlerRef])

  const playheadLeft = useMemo(
    () => (creative.playheadTime / creative.cycleLength) * 100,
    [creative.playheadTime, creative.cycleLength],
  )

  // Lookup del evento seleccionado. Si el track fue borrado o el índice
  // está fuera de rango, devolvemos null y el editor se cierra.
  const selectedEventData = useMemo(() => {
    if (!creative.selectedEvent) return null
    const { trackId, eventIndex } = creative.selectedEvent
    const track = creative.tracks.find((t) => t.id === trackId)
    const event = track?.events[eventIndex]
    if (!event) return null
    return { track, event, trackId, eventIndex }
  }, [creative.selectedEvent, creative.tracks])

  // Ref al contenedor principal: click fuera del editor y de cualquier
  // rectángulo cierra el editor (deselecciona). El handler lee creative
  // desde un ref para que el effect no se re-suscriba cada render
  // (creative es un objeto nuevo en cada render del hook).
  const containerRef = useRef(null)
  const creativeRef = useRef(creative)
  useEffect(() => {
    creativeRef.current = creative
  })
  useEffect(() => {
    if (!creative.selectedEvent) return
    const onPointerDown = (e) => {
      // Si el click está dentro del editor, no hacemos nada (el editor
      // tiene su propio onClick stopPropagation, pero por si acaso).
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        creativeRef.current.setSelectedEvent(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [creative.selectedEvent])

  // Atajos de teclado para la nota seleccionada: Backspace/Delete borra,
  // Escape deselecciona. NO actuar si el foco está en un input (el
  // usuario podría estar escribiendo en el editor de tiempo/duración).
  useEffect(() => {
    if (!creative.selectedEvent) return
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const sel = creativeRef.current.selectedEvent
      if (!sel) return
      if (e.key === 'Escape') {
        e.preventDefault()
        creativeRef.current.setSelectedEvent(null)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        creativeRef.current.deleteEvent(sel.trackId, sel.eventIndex)
        creativeRef.current.setSelectedEvent(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creative.selectedEvent])

  return (
    <div className="creative" ref={containerRef}>
      <CreativeHeader
        loopStart={creative.loopStart}
        loopEnd={creative.loopEnd}
        cycleLength={creative.cycleLength}
        isPlaying={creative.isPlaying}
        playheadLeft={playheadLeft}
        onPlay={creative.start}
        onStop={creative.stop}
        onClearAll={creative.clearAll}
        onBack={onExit}
        onExport={creative.exportSong}
        isExporting={creative.isExporting}
        exportError={creative.exportError}
        hasEvents={creative.tracks.some((t) => t.events.length > 0)}
        onLoopStartChange={creative.setLoopStart}
        onLoopEndChange={creative.setLoopEnd}
        bpm={metronome.bpm}
      />

      <div className="creative-tracks" aria-label="Pistas del modo creative">
        {creative.tracks.map((track) => (
          <CreativeTrack
            key={track.id}
            track={track}
            isActive={track.id === creative.activeTrackId}
            loopLength={creative.cycleLength}
            loopStart={creative.loopStart}
            playheadLeft={playheadLeft}
            selectedIndex={
              creative.selectedEvent?.trackId === track.id
                ? creative.selectedEvent.eventIndex
                : null
            }
            available={creative.availableInstruments}
            onSelectInstrument={creative.setInstrument}
            onToggleOverwrite={creative.toggleOverwrite}
            onToggleMute={creative.toggleMute}
            onClear={creative.clearTrack}
            onDeleteEvent={creative.deleteEvent}
            onUpdateEvent={creative.updateEvent}
            onSelectEvent={creative.selectEvent}
            onActivate={() => creative.setActiveTrack(track.id)}
          />
        ))}
      </div>

      <Keyboard
        activeNotes={activeNotes}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />

      {selectedEventData && (
        <CreativeEventEditor
          // Key fuerza re-mount al cambiar de evento — el draft se
          // reinicializa desde el prop sin necesidad de useEffect de sync.
          key={`${selectedEventData.trackId}-${selectedEventData.eventIndex}`}
          event={selectedEventData.event}
          loopLength={creative.cycleLength}
          trackColor={selectedEventData.track.color}
          onChange={(updates) =>
            creative.updateEvent(
              selectedEventData.trackId,
              selectedEventData.eventIndex,
              updates,
            )
          }
          onDelete={() => {
            creative.deleteEvent(
              selectedEventData.trackId,
              selectedEventData.eventIndex,
            )
            creative.setSelectedEvent(null)
          }}
          onClose={() => creative.setSelectedEvent(null)}
        />
      )}

      <p className="creative-hint">
        Modo creative · 8 pistas × 2 compases · Toca una pista para activarla, elige instrumento y pulsa <strong>Play</strong> para empezar a grabar el loop.
      </p>
    </div>
  )
}