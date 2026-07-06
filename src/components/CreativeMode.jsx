import { useCallback, useEffect, useMemo } from 'react'
import { useCreativeMode } from '../hooks/useCreativeMode.js'
import { useMetronome } from '../hooks/useMetronome.js'
import { Keyboard } from './Keyboard.jsx'
import { CreativeHeader } from './CreativeHeader.jsx'
import { CreativeTrack } from './CreativeTrack.jsx'

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
    () => (creative.playheadTime / creative.loopLength) * 100,
    [creative.playheadTime, creative.loopLength],
  )

  return (
    <div className="creative">
      <CreativeHeader
        loopLength={creative.loopLength}
        isPlaying={creative.isPlaying}
        onPlay={creative.start}
        onStop={creative.stop}
        onClearAll={creative.clearAll}
        onBack={onExit}
        onExport={creative.exportSong}
        isExporting={creative.isExporting}
        hasEvents={creative.tracks.some((t) => t.events.length > 0)}
        bpm={metronome.bpm}
      />

      <div className="creative-tracks" aria-label="Pistas del modo creative">
        <div
          className="creative-playhead"
          style={{ left: `${playheadLeft}%` }}
          aria-hidden="true"
        />
        {creative.tracks.map((track) => (
          <CreativeTrack
            key={track.id}
            track={track}
            isActive={track.id === creative.activeTrackId}
            loopLength={creative.loopLength}
            available={creative.availableInstruments}
            onSelectInstrument={creative.setInstrument}
            onToggleOverwrite={creative.toggleOverwrite}
            onToggleMute={creative.toggleMute}
            onClear={creative.clearTrack}
            onActivate={() => creative.setActiveTrack(track.id)}
          />
        ))}
      </div>

      <Keyboard
        activeNotes={activeNotes}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />

      <p className="creative-hint">
        Modo creative · 8 pistas × 2 compases · Toca una pista para activarla, elige instrumento y pulsa <strong>Play</strong> para empezar a grabar el loop.
      </p>
    </div>
  )
}