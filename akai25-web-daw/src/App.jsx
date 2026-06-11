import { useMidi } from './hooks/useMidi.js'
import './App.css'

// Convierte un número MIDI a nombre legible (ej. 60 -> "C4").
function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${names[midi % 12]}${octave}`
}

export default function App() {
  const { isReady, deviceName, activeNotes, error, inputCount, start } = useMidi()

  return (
    <div className="app">
      <header className="app__header">
        <h1>AKAI25 Web DAW</h1>
        <p className="app__subtitle">Hito 1 · Fundación (Conexión y Sonido)</p>
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
            <div className="status__row">
              <span className="status__label">Notas activas</span>
              <span className="status__value status__value--notes">
                {activeNotes.size === 0
                  ? <em>toca una tecla del Akai…</em>
                  : Array.from(activeNotes).sort((a, b) => a - b).map(midiToNoteName).join(' · ')}
              </span>
            </div>
          </section>
        )}
      </main>

      <footer className="app__footer">
        <small>Toca las teclas de tu Akai LPK25 para escuchar el sintetizador.</small>
      </footer>
    </div>
  )
}
