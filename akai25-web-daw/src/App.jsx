import { useMemo } from 'react'
import { useMidi } from './hooks/useMidi.js'
import { Keyboard } from './components/Keyboard.jsx'
import { midiToNoteName } from './utils/notes.js'
import './App.css'

export default function App() {
  const { isReady, deviceName, activeNotes, error, inputCount, start } = useMidi()

  // Notas activas ordenadas para mostrarlas como un acorde legible.
  const sortedActiveNotes = useMemo(
    () => Array.from(activeNotes).sort((a, b) => a - b),
    [activeNotes],
  )

  return (
    <div className="app">
      <header className="app__header">
        <h1>AKAI25 Web DAW</h1>
        <p className="app__subtitle">Hito 2 · Interfaz Visual y Feedback</p>
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

            <div className="note-display" aria-live="polite">
              {sortedActiveNotes.length === 0 ? (
                <span className="note-display__hint">Toca una tecla del Akai…</span>
              ) : (
                <span className="note-display__chord">
                  {sortedActiveNotes.map(midiToNoteName).join(' · ')}
                </span>
              )}
            </div>

            <Keyboard activeNotes={activeNotes} />
          </>
        )}
      </main>

      <footer className="app__footer">
        <small>Toca las teclas de tu Akai LPK25 — las teclas virtuales se iluminan al ritmo.</small>
      </footer>
    </div>
  )
}
