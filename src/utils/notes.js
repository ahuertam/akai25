// Utilidades puras para manipulación de notas MIDI.
// Sin dependencias de React, para que sean fáciles de testear y reutilizar.

export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
]

// Pitch classes (MIDI % 12) que corresponden a teclas negras en un piano.
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

/** Devuelve true si el número MIDI corresponde a una tecla negra. */
export function isBlackKey(midi) {
  return BLACK_PITCH_CLASSES.has(midi % 12)
}

/** Convierte un número MIDI (0–127) a un nombre legible, p.ej. 60 -> "C4". */
export function midiToNoteName(midi) {
  const pitchClass = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pitchClass]}${octave}`
}

/** Parsea un nombre de nota como "C4" o "F#3" a su número MIDI. */
export function noteNameToMidi(noteName) {
  const match = noteName.match(/^([A-G])(#|b)?(-?\d+)$/)
  if (!match) return null
  const [, letter, accidental, octaveStr] = match
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter]
  const acc = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return (parseInt(octaveStr, 10) + 1) * 12 + base + acc
}

/**
 * Dado un rango MIDI, devuelve la lista de teclas blancas y negras con la
 * información de posición necesaria para renderizar un teclado de piano.
 *
 *   whiteKeys: [{ midi, whiteIndex }]
 *     whiteIndex es la posición de la tecla dentro de la fila de blancas
 *     (0, 1, 2, ...). Útil para calcular el ancho en CSS.
 *
 *   blackKeys: [{ midi, afterWhiteIndex }]
 *     afterWhiteIndex es el índice de la tecla blanca a la IZQUIERDA del
 *     hueco donde se coloca la negra. La negra se centra sobre el borde
 *     entre la tecla afterWhiteIndex y la siguiente.
 */
export function getKeyboardLayout(startMidi, endMidi) {
  const whiteKeys = []
  const blackKeys = []
  let whiteIndex = 0
  for (let m = startMidi; m <= endMidi; m++) {
    if (isBlackKey(m)) {
      blackKeys.push({ midi: m, afterWhiteIndex: whiteIndex - 1 })
    } else {
      whiteKeys.push({ midi: m, whiteIndex })
      whiteIndex++
    }
  }
  return { whiteKeys, blackKeys }
}
