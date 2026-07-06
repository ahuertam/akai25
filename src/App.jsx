import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { PitchBendSlider } from './components/PitchBendSlider.jsx'
import { SustainToggle } from './components/SustainToggle.jsx'
import { CreativeMode } from './components/CreativeMode.jsx'
import {
  releaseAll as silenceSynth,
  pitchBend as applyPitchBend,
  setModWheel as applyModWheel,
  setSustain as applySustain,
  setReverbWet as applyReverbWet,
} from './audio/synth.js'
import { midiToNoteName } from './utils/notes.js'
import './App.css'

// Rango del pitch bend en cents (±2 semitonos es lo natural para
// guitarra; cubre bends de blues/rock sin caer en el semitono siguiente
// por accidente). El slider en pantalla y la rueda MIDI escalan a esto.
const PITCH_BEND_RANGE_CENTS = 200
// Wet inicial del reverb master.
const INITIAL_REVERB_WET = 0.25

export default function App() {
  const recorder = useRecorder()
  const instrument = useInstrument()
  const metronome = useMetronome()

  // Modo de vista. 'normal' = DAW lineal clásico (un sinte). 'creative'
  // = multipista con loop. Se cambia haciendo click en el chip del
  // dispositivo (esquina superior derecha). El botón "Volver" del
  // creative hace setMode('normal').
  const [mode, setMode] = useState('normal')

  // ponytail: puente MIDI ↔ modo. CreativeMode expone sus handlers
  // (recordEvent/releaseNote) en este ref cuando monta; App.jsx
  // consulta `mode` + `creativeMidiRef.current` para rutear las
  // NoteOn/NoteOff del Akai. Sin esto el MIDI siempre iba a
  // recorder.handleNoteOn → currentSynth (instrumento del modo
  // normal), aunque estuvieras en creative.
  const creativeMidiRef = useRef(null)
  // recorder cambia de referencia en cada render (useRecorder devuelve
  // objeto nuevo), así que para no re-crear routeNoteOn/Off lo paso por
  // un ref y leo el último en el momento de la llamada.
  const recorderRef = useRef(recorder)
  useEffect(() => {
    recorderRef.current = recorder
  })
  const routeNoteOn = useCallback(
    (midi, velocity) => {
      if (mode === 'creative' && creativeMidiRef.current) {
        creativeMidiRef.current.onNoteOn(midi, velocity)
      } else {
        recorderRef.current.handleNoteOn(midi, velocity)
      }
    },
    [mode],
  )
  const routeNoteOff = useCallback(
    (midi) => {
      if (mode === 'creative' && creativeMidiRef.current) {
        creativeMidiRef.current.onNoteOff(midi)
      } else {
        recorderRef.current.handleNoteOff(midi)
      }
    },
    [mode],
  )

  // Estado de los efectos. Cada uno tiene un slider/control y se
  // mantiene sincronizado con la rueda MIDI correspondiente.
  const [pitchBend, setPitchBend] = useState(0)          // -1..+1
  const [pitchBendSticky, setPitchBendSticky] = useState(false) // true = sin auto-retorno
  const [modWheel, setModWheel] = useState(0)            // 0..1 (CC#1)
  const [sustainOn, setSustainState] = useState(false)   // CC#64
  const [reverbWet, setReverbWet] = useState(INITIAL_REVERB_WET) // 0..1

  const handlePitchBend = useCallback((normalized) => {
    setPitchBend(normalized)
    applyPitchBend(normalized * PITCH_BEND_RANGE_CENTS)
  }, [])

  // Al soltar el slider de pitch, normalmente vuelve al centro y mandamos
  // bend=0 al sinte (igual que la rueda con muelle del Akai). Si el
  // usuario activa el modo sticky, el slider se queda donde lo dejó.
  // (Los sliders mod/reverb no tienen auto-retorno → onRelease no-op.)
  const handlePitchBendRelease = useCallback(() => {
    if (pitchBendSticky) return
    setPitchBend(0)
    applyPitchBend(0)
  }, [pitchBendSticky])

  const handleModWheel = useCallback((value) => {
    setModWheel(value)
    applyModWheel(value)
  }, [])

  const handleSustain = useCallback((on) => {
    setSustainState(on)
    applySustain(on)
  }, [])

  // Toggle manual desde el botón en pantalla (para cuando no hay
  // pedal físico MIDI conectado).
  const handleSustainToggle = useCallback(() => {
    handleSustain(!sustainOn)
  }, [handleSustain, sustainOn])

  const handleReverb = useCallback((value) => {
    setReverbWet(value)
    applyReverbWet(value)
  }, [])

  const {
    isReady,
    deviceName,
    activeNotes,
    error,
    inputs,
    selectedInputId,
    selectInput,
    inputCount,
    lastCC,
    start,
    playNote,
    stopNote,
  } = useMidi({
    onNoteOn: routeNoteOn,
    onNoteOff: routeNoteOff,
    onPitchBend: handlePitchBend,
    onModWheel: handleModWheel,
    onSustain: handleSustain,
  })

  // Refleja el último Control Change recibido durante 2 segundos.
  // Los botones de octava del Akai envían CC, no Note On/Off, así que
  // sin esto el usuario no ve confirmación de que el pulsó llegó.
  // El setTimeout(..., 0) evita el aviso de react-hooks/set-state-in-effect
  // sin perder inmediatez visual: sigue apareciendo en el siguiente frame.
  const [displayedCC, setDisplayedCC] = useState(null)
  useEffect(() => {
    if (!lastCC) return
    const showId = setTimeout(() => setDisplayedCC(lastCC), 0)
    const hideId = setTimeout(() => setDisplayedCC(null), 2000)
    return () => {
      clearTimeout(showId)
      clearTimeout(hideId)
    }
  }, [lastCC])

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
      <header className={`app__header app__header--with-chip${mode === 'creative' ? ' is-compact' : ''}`}>
        <div className="app__title">
          <h1>AKAI25 Web DAW</h1>
          <p className="app__subtitle">Hito 4 · Pulizado, Persistencia y Extras</p>
        </div>
        {isReady && (
          <button
            type="button"
            className={`device-chip${mode === 'creative' ? ' is-active' : ''}`}
            onClick={() => setMode(mode === 'creative' ? 'normal' : 'creative')}
            aria-pressed={mode === 'creative'}
            aria-label={mode === 'creative' ? 'Volver al modo normal' : 'Abrir modo creative multipista'}
          >
            <span className="device-chip__icon" aria-hidden="true">🎚</span>
            <span className="device-chip__body">
              <span className="device-chip__label">
                {mode === 'creative' ? 'Volver' : 'Modo creative'}
              </span>
              <span className="device-chip__name">
                {deviceName ?? 'ninguno conectado'}
              </span>
            </span>
            <span className="device-chip__arrow" aria-hidden="true">
              {mode === 'creative' ? '←' : '→'}
            </span>
          </button>
        )}
      </header>

      {mode === 'creative' && isReady ? (
        <main className="app__main app__main--creative">
          <CreativeMode
            onExit={() => setMode('normal')}
            activeNotes={activeNotes}
            midiHandlerRef={creativeMidiRef}
          />
        </main>
      ) : (

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
              {displayedCC && (
                <div className="status__row status__row--cc" aria-live="polite">
                  <span className="status__label">Control Change</span>
                  <span className="status__value">
                    CC#{displayedCC.controller} = {displayedCC.value}
                    {' '}
                    <small>(ch {displayedCC.channel})</small>
                  </span>
                </div>
              )}
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
              <PitchBendSlider
                value={pitchBend}
                onChange={handlePitchBend}
                onRelease={handlePitchBendRelease}
                title="Pitch"
                leftLabel="−2"
                centerLabel="0"
                rightLabel="+2"
                showCenter
                ariaLabel="Pitch bend (±2 semitonos)"
              />
              <label
                className={`pitch-bend__sticky${pitchBendSticky ? ' is-on' : ''}`}
                title="Si está activo, el pitch no vuelve al centro al soltar el slider"
              >
                <input
                  type="checkbox"
                  checked={pitchBendSticky}
                  onChange={(e) => setPitchBendSticky(e.target.checked)}
                  aria-label="Pitch sin retorno al centro"
                />
                <span>Mantener</span>
              </label>
              <PitchBendSlider
                value={modWheel}
                min={0}
                max={1}
                onChange={handleModWheel}
                title="Mod"
                leftLabel="0"
                rightLabel="+"
                ariaLabel="Modulación (CC#1) — controla el corte del filtro"
              />
              <PitchBendSlider
                value={reverbWet}
                min={0}
                max={1}
                onChange={handleReverb}
                title="Reverb"
                leftLabel="0%"
                rightLabel="100%"
                ariaLabel="Cantidad de reverb master"
              />
              <SustainToggle isOn={sustainOn} onToggle={handleSustainToggle} />
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
              loop={recorder.loop}
              onLoopChange={recorder.setLoop}
              onRecord={recorder.startRecording}
              onStop={() => {
                // Parada universal: silencia cualquier nota colgada (incl.
                // el bug de Monophonic donde triggerRelease(freq) programa
                // un release a 440s) y, si hay algo en curso, lo para.
                silenceSynth()
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
      )}

      <footer className="app__footer">
        <small>Conecta tu Akai o haz clic en el teclado — todo se graba y persiste igual.</small>
      </footer>
    </div>
  )
}
