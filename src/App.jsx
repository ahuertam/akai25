import { useMemo } from 'react'
import { useMidi } from './hooks/useMidi.js'
import { useRecorder } from './hooks/useRecorder.js'
import { useInstrument } from './hooks/useInstrument.js'
import { useMetronome } from './hooks/useMetronome.js'
import { Keyboard } from './components/Keyboard.jsx'
import { Transport } from './components/Transport.jsx'
import { InstrumentSelector } from './components/InstrumentSelector.jsx'
import { MetronomeControl } from './components/MetronomeControl.jsx'
import { DeviceSelector } from './components/DeviceSelector.jsx'
import { PersistenceControls } from './components/PersistenceControls.jsx'
import { midiToNoteName } from './utils/notes.js'
import './App.css'

export default function App() {
  const recorder = useRecorder()
  const instrument = useInstrument()
  const metronome = useMetronome()

  const {
    isReady,
    deviceName,
    activeNotes,
    error,
    inputs,
    selectedInputId,
    selectInput,
    inputCount,
    start,
    playNote,
    stopNote,
  } = useMidi({
    onNoteOn: recorder.handleNoteOn,
    onNoteOff: recorder.handleNoteOff,
  })

  // El teclado muestra tanto las notas tocadas en vivo como las que
  // están sonando durante la reproducción.
  const allActiveNotes = useMemo(() => {
    if (recorder.playbackActiveNotes.size === 0) return activeNotes
    const merged = new Set(activeNotes)
    for (const n of recorder.playbackActiveNotes) merged.add(n)
    return merged
  }, [activeNotes, recorder.playbackActiveNotes])

  // Notas activas ordenadas (solo del MIDI en vivo, no del playback).
  const sortedActiveNotes = useMemo(
    () => Array.from(activeNotes).sort((a, b) => a - b),
    [activeNotes],
  )

  return (
    <div className="app">
      <header className="app__header">
        <h1>AKAI25 Web DAW</h1>
        <p className="app__subtitle">Hito 4 · Pulido, Persistencia y Extras</p>
      </header>

      <main className="app__main">
        {!isReady && !error && (
          <button
            type="button"
            className="connect-button"
            onClick={start}
            aria-label="Conectar al dispositivo MIDI y activar audio"
          >
            <span className="connect-button__icon" aria-hidden="true">🎹</span>
            <span className="connect-button__label">Conectar</span>
            <span className="connect-button__hint">Activa el audio y permite el acceso MIDI</span>
          </button>
        )}

        {error && (
          <div className="status status--error" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        {isReady && (
          <>
            <section className="status">
              <div className="status__row">
                <span className="status__label">Dispositivo</span>
                <span className="status__value">
                  {deviceName ?? <em>ninguno conectado</em>}
                </span>
              </div>
              <div className="status__row">
                <span className="status__label">Inputs MIDI</span>
                <span className="status__value">{inputCount}</span>
              </div>
            </section>

            <DeviceSelector
              inputs={inputs}
              selectedInputId={selectedInputId}
              onSelect={selectInput}
            />

            <section className="controls">
              <InstrumentSelector
                instrumentId={instrument.instrumentId}
                available={instrument.available}
                onChange={instrument.setInstrument}
              />
              <MetronomeControl
                isEnabled={metronome.isEnabled}
                isTicking={metronome.isTicking}
                bpm={metronome.bpm}
                minBpm={metronome.minBpm}
                maxBpm={metronome.maxBpm}
                onToggle={metronome.toggle}
                onBpmChange={metronome.setBpm}
              />
              <PersistenceControls
                events={recorder.recordedEvents}
                isRecording={recorder.isRecording}
                isPlaying={recorder.isPlaying}
                onClear={recorder.clearRecording}
              />
            </section>

            <Transport
              isRecording={recorder.isRecording}
              isPlaying={recorder.isPlaying}
              eventCount={recorder.recordedEvents.length}
              onRecord={recorder.startRecording}
              onStop={() => {
                if (recorder.isRecording) recorder.stopRecording()
                else if (recorder.isPlaying) recorder.stopPlayback()
              }}
              onPlay={recorder.playRecording}
            />

            <div className="note-display" aria-live="polite">
              {sortedActiveNotes.length === 0 ? (
                <span className="note-display__hint">
                  {recorder.isRecording
                    ? 'Grabando… toca el Akai o haz clic en el teclado'
                    : recorder.isPlaying
                      ? 'Reproduciendo…'
                      : 'Toca el Akai o haz clic en el teclado…'}
                </span>
              ) : (
                <span className="note-display__chord">
                  {sortedActiveNotes.map(midiToNoteName).join(' · ')}
                </span>
              )}
            </div>

            <Keyboard
              activeNotes={allActiveNotes}
              onKeyDown={playNote}
              onKeyUp={stopNote}
            />
          </>
        )}
      </main>

      <footer className="app__footer">
        <small>Conecta tu Akai o haz clic en el teclado — todo se graba y persiste igual.</small>
      </footer>
    </div>
  )
}
