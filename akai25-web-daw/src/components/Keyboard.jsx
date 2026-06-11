import { useMemo } from 'react'
import { getKeyboardLayout, midiToNoteName } from '../utils/notes.js'

/**
 * Teclado de piano virtual. Renderiza una fila de teclas blancas con las
 * teclas negras superpuestas mediante posicionamiento absoluto.
 *
 * Props:
 *   - activeNotes: Set<number> con los números MIDI actualmente activos.
 *   - startMidi:   número MIDI más bajo a renderizar (por defecto C2 = 36).
 *   - endMidi:     número MIDI más alto a renderizar (por defecto C5 = 72).
 *   - onKeyDown / onKeyUp: callbacks opcionales al pulsar/soltar una tecla
 *     virtual con el ratón (Hito 4 ya los aprovechará; en Hito 2 solo se usa
 *     para que el cursor cambie a "pointer" al hacer hover).
 */
export function Keyboard({
  activeNotes,
  startMidi = 36,
  endMidi = 72,
  onKeyDown,
  onKeyUp,
}) {
  const { whiteKeys, blackKeys } = useMemo(
    () => getKeyboardLayout(startMidi, endMidi),
    [startMidi, endMidi],
  )

  // Ancho de cada tecla blanca como porcentaje del contenedor.
  const whiteWidthPercent = 100 / whiteKeys.length
  // Las teclas negras son ~60% del ancho de una blanca, centradas en el borde.
  const blackWidthPercent = whiteWidthPercent * 0.6
  const blackLeftOffset = whiteWidthPercent * 0.7

  return (
    <div className="keyboard" role="group" aria-label="Teclado virtual">
      <div className="keyboard__row">
        {whiteKeys.map(({ midi }) => (
          <Key
            key={midi}
            midi={midi}
            variant="white"
            isActive={activeNotes.has(midi)}
            onPointerDown={onKeyDown ? () => onKeyDown(midi) : undefined}
            onPointerUp={onKeyUp ? () => onKeyUp(midi) : undefined}
          />
        ))}
      </div>
      <div className="keyboard__black-layer">
        {blackKeys.map(({ midi, afterWhiteIndex }) => (
          <Key
            key={midi}
            midi={midi}
            variant="black"
            isActive={activeNotes.has(midi)}
            style={{
              left: `${afterWhiteIndex * whiteWidthPercent + blackLeftOffset}%`,
              width: `${blackWidthPercent}%`,
            }}
            onPointerDown={onKeyDown ? () => onKeyDown(midi) : undefined}
            onPointerUp={onKeyUp ? () => onKeyUp(midi) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Una tecla individual. Mantenemos el `Key` interno porque la lógica de
 * estilo difiere mucho entre blancas y negras, pero ambos comparten
 * estructura DOM y comportamiento.
 */
function Key({ midi, variant, isActive, style, onPointerDown, onPointerUp }) {
  const noteName = midiToNoteName(midi)
  const className = `key key--${variant}${isActive ? ' key--active' : ''}`

  return (
    <div
      className={className}
      style={style}
      data-midi={midi}
      data-note={noteName}
      data-active={isActive || undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <span className="key__label" aria-hidden="true">{noteName}</span>
    </div>
  )
}
