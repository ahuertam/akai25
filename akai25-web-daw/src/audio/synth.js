import * as Tone from 'tone'

// PolySynth polifónico singleton.
// Lo creamos fuera de React para no reinstanciarlo en cada render y para
// poder reutilizar la misma instancia desde el hook de MIDI y, más adelante,
// desde el módulo de grabación (Hito 3).
const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' },
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6 },
}).toDestination()

// Volumen general moderado para que el "beep" no resulte agresivo.
synth.volume.value = -8

/**
 * Inicia el contexto de audio. Debe llamarse desde un gesto de usuario
 * (clic) porque los navegadores bloquean AudioContext hasta entonces.
 */
export async function startAudio() {
  await Tone.start()
}

/**
 * Convierte un número de nota MIDI (0–127) a una frecuencia en Hz
 * usando la afinación estándar A4 = 440 Hz.
 */
export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Dispara una nota. Si la nota ya está sonando, PolySynth la "reinicia"
 * (re-trigger), que es el comportamiento que queremos al pulsar repetidamente.
 */
export function triggerNote(midi, velocity = 0.8) {
  const freq = midiToFrequency(midi)
  synth.triggerAttack(freq, undefined, velocity)
}

/**
 * Suelta una nota. PolySynth aplica el envelope de release configurado.
 */
export function releaseNote(midi) {
  const freq = midiToFrequency(midi)
  synth.triggerRelease(freq)
}

/**
 * Silencia todas las notas que estén sonando. Útil al desconectar el
 * dispositivo MIDI o al detener una grabación.
 */
export function releaseAll() {
  synth.releaseAll()
}

export { synth }
