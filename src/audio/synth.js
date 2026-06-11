import * as Tone from 'tone'

// Estado interno del sintetizador. Usamos un `let` (no `const`) y un getter
// para poder intercambiar el instrumento en caliente sin que los hooks
// tengan que re-suscribirse a nada. `triggerNote`/`releaseNote` siempre
// operan sobre `currentSynth` en el momento de la llamada.
let currentSynth = null
let currentInstrumentName = null

/**
 * Presets disponibles. Cada entrada incluye un `id` (clave), `label`
 * (para la UI) y una función `create()` que devuelve una instancia nueva
 * de Tone.js ya configurada. Separamos la creación de la conexión a
 * destination para poder medir/ajustar el volumen desde un solo punto.
 */
const INSTRUMENT_PRESETS = {
  synth: {
    label: 'Synth',
    description: 'Polifónico triangular (genérico)',
    create: () => new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6 },
    }),
  },
  piano: {
    label: 'Piano',
    description: 'Polifónico con envolvente de piano',
    create: () => new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.5, sustain: 0.15, release: 0.9 },
    }),
  },
  bass: {
    label: 'Bass',
    description: 'Monofónico con filtro (mono = una nota a la vez)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
      filterEnvelope: {
        attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4,
        baseFrequency: 200, octaves: 2.5,
      },
    }),
  },
  pluck: {
    label: 'Pluck',
    description: 'Cuerda pulsada (Karplus-Strong, mono)',
    create: () => new Tone.PluckSynth({
      attackNoise: 1, dampening: 4000, resonance: 0.9,
    }),
  },
  fm: {
    label: 'FM Bell',
    description: 'Síntesis FM con modulación sinusoidal',
    create: () => new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 10,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 1.2 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.5, decay: 0, sustain: 0, release: 0.5 },
    }),
  },
}

/** Lista inmutable de instrumentos para alimentar el selector de la UI. */
export const AVAILABLE_INSTRUMENTS = Object.entries(INSTRUMENT_PRESETS).map(
  ([id, value]) => ({
    id,
    label: value.label,
    description: value.description,
  }),
)

/** Cambia el instrumento actual. Dispone el anterior y conecta el nuevo. */
function setInstrumentInternal(name) {
  if (name === currentInstrumentName && currentSynth) return
  const preset = INSTRUMENT_PRESETS[name]
  if (!preset) throw new Error(`Unknown instrument: ${name}`)

  if (currentSynth) {
    // releaseAll() solo existe en instrumentos polifónicos (PolySynth) y
    // monofónicos basados en Monophonic (MonoSynth, FMSynth, AMSynth).
    // PluckSynth y otros heredan de Instrument directamente y no lo
    // implementan → en esos casos dejamos que el envelope/decay complete
    // el ciclo de la nota de forma natural antes de disponer.
    if (typeof currentSynth.releaseAll === 'function') {
      currentSynth.releaseAll()
    }
    currentSynth.dispose()
  }
  currentSynth = preset.create()
  currentSynth.volume.value = -8
  currentSynth.toDestination()
  currentInstrumentName = name
}

/** Devuelve la instancia actual del sintetizador (la puede usar useRecorder). */
export function getSynth() {
  return currentSynth
}

/** Devuelve el id del instrumento activo. */
export function getCurrentInstrumentName() {
  return currentInstrumentName
}

/** Cambia el instrumento activo. Idempotente para el mismo nombre. */
export function setInstrument(name) {
  setInstrumentInternal(name)
  return currentInstrumentName
}

// Inicializamos con el preset por defecto al cargar el módulo. Esto ocurre
// antes de que el usuario pulse "Conectar", pero Tone.js no necesita que
// el AudioContext esté corriendo para construir los instrumentos; solo
// los necesita cuando se dispara un triggerAttack.
setInstrumentInternal('synth')

/**
 * Inicia el contexto de audio. Debe llamarse desde un gesto de usuario
 * (clic) porque los navegadores bloquean AudioContext hasta entonces.
 */
export async function startAudio() {
  await Tone.start()
}

/** Convierte un número de nota MIDI (0–127) a una frecuencia en Hz. */
export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Dispara una nota sobre el sintetizador actual. */
export function triggerNote(midi, velocity = 0.8) {
  if (!currentSynth) return
  const freq = midiToFrequency(midi)
  currentSynth.triggerAttack(freq, undefined, velocity)
}

/** Suelta una nota sobre el sintetizador actual. */
export function releaseNote(midi) {
  if (!currentSynth) return
  const freq = midiToFrequency(midi)

  // Bass usa Tone.MonoSynth (monofónico). En algunas versiones de Tone.js,
  // MonoSynth.triggerRelease(freq) no libera la nota si la frecuencia que
  // le pasas no coincide exactamente con la almacenada internamente en
  // el Signal `_frequency` (puede fallar por precisión de coma flotante).
  // Como solo puede sonar una nota a la vez, releaseAll() es seguro y
  // libera la nota actual de forma confiable.
  if (currentInstrumentName === 'bass') {
    if (typeof currentSynth.releaseAll === 'function') {
      currentSynth.releaseAll()
    } else {
      currentSynth.triggerRelease(freq)
    }
    return
  }

  // PolySynth (Synth, Piano, FM) y PluckSynth: triggerRelease por
  // frecuencia para liberar solo la nota soltada, sin afectar a las
  // demás notas que estén sonando (importante al tocar acordes).
  currentSynth.triggerRelease(freq)
}

/** Silencia todas las notas que estén sonando. */
export function releaseAll() {
  if (!currentSynth) return
  // Verificamos la existencia del método porque no todos los instrumentos
  // de Tone.js lo implementan (p.ej. PluckSynth).
  if (typeof currentSynth.releaseAll === 'function') {
    currentSynth.releaseAll()
  }
}
