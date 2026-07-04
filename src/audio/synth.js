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
  piano2: {
    label: 'Piano 2',
    description: 'Piano acústico real (samples)',
    create: () => new Tone.Sampler({
      urls: {
        A1: 'A1.mp3', A2: 'A2.mp3', A3: 'A3.mp3',
        A4: 'A4.mp3', A5: 'A5.mp3', A6: 'A6.mp3',
        C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3',
      },
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      release: 1,
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
  // Estilo TB-303: saw + filtro lowpass resonante con envelope que barre
  // 4 octavas. El "squelch" viene de filterEnvelope.sustain bajo + Q alta.
  acid: {
    label: 'Acid',
    description: 'TB-303: saw + filtro resonante (squelchy)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 8, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.25 },
      filterEnvelope: {
        attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.25,
        baseFrequency: 80, octaves: 4, exponent: 2,
      },
    }),
  },
  // Bombo sintetizado: MembraneSynth = sine con pitch envelope que cae
  // varias octavas en pocos ms (el "boom" característico del 808).
  kick: {
    label: 'Kick',
    description: 'Bombo sintetizado (estilo 808)',
    create: () => new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 1.4 },
    }),
  },
  // Plato / hi-hat sintetizado: MetalSynth usa FM con modulationIndex
  // alto y resonancia para conseguir el carácter metálico brillante.
  hihat: {
    label: 'Hi-Hat',
    description: 'Plato cerrado (FM + resonancia)',
    create: () => new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }),
  },
  // Palmas sintetizadas: NoiseSynth = burst de ruido blanco con envelope
  // cortísimo. Sin filtro (NoiseSynth no soporta), pero el decay rápido
  // ya da el carácter percusivo del clap house.
  clap: {
    label: 'Clap',
    description: 'Palmas (noise + decay corto)',
    create: () => new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
    }),
    // Los drums necesitan estar más altos que el resto del mix.
    volume: -4,
  },
  // Sub-bass puro: sine sin osciladores armónicos, filter cut muy bajo.
  // Da ese "peso" sub-grave que se siente en el pecho en la música house.
  subbass: {
    label: 'Sub Bass',
    description: 'Sub grave puro (sine, sin armónicos)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      filter: { Q: 1, type: 'lowpass', rolloff: -12 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.6 },
      filterEnvelope: {
        attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.4,
        baseFrequency: 60, octaves: 1,
      },
    }),
  },
  // Pad atmosférico: PolySynth de sawtooths con ataque y release largos.
  // La polifonía del PolySynth da grosor natural sin detune manual.
  pad: {
    label: 'Pad',
    description: 'Pad atmosférico (saw + envolvente larga)',
    create: () => new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.8, decay: 0.3, sustain: 0.8, release: 1.5 },
    }),
  },
  // Lead de house: MonoSynth saw con portamento corto para slides
  // entre notas. FilterEnvelope modula brillo para movimiento.
  lead: {
    label: 'House Lead',
    description: 'Lead con portamento (saw + slide)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 3, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.3 },
      filterEnvelope: {
        attack: 0.05, decay: 0.4, sustain: 0.3, release: 0.5,
        baseFrequency: 400, octaves: 2.5,
      },
      portamento: 0.05,
    }),
  },
  // Stylophone (Dubreq, 1968): square + decay cortísimo + portamento
  // muy corto para reproducir el "weow-weow" del deslizamiento del
  // stylus. Icónico en "Space Oddity" (Bowie) y temas de Kraftwerk.
  stylophone: {
    label: 'Stylophone',
    description: 'Stylophone retro (square + glide corto)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: { Q: 2, type: 'lowpass', rolloff: -12 },
      envelope: { attack: 0.005, decay: 0.08, sustain: 0.5, release: 0.15 },
      filterEnvelope: {
        attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.2,
        baseFrequency: 1500, octaves: 1.5,
      },
      portamento: 0.02,
    }),
  },
  // Guitarra acústica: PolySynth(Synth) con triangle + envelope corto
  // tipo pluck. Polifónico para que se puedan tocar acordes (a diferencia
  // del PluckSynth monofónico existente).
  guitar: {
    label: 'Guitarra',
    description: 'Acústica (pluck polifónico)',
    create: () => new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0.05, release: 0.6 },
    }),
  },
  // Guitarra eléctrica: MonoSynth saw + filter envelope agresivo (efecto
  // wah automático) + portamento para bends.
  eguit: {
    label: 'Guitarra eléctrica',
    description: 'Eléctrica con wah (saw + filter env)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 4, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.3 },
      filterEnvelope: {
        attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.3,
        baseFrequency: 500, octaves: 3,
      },
      portamento: 0.05,
    }),
  },
  // Xilófono: PolySynth(FMSynth) con modulationIndex alto y decay
  // muy corto. La modulación square añade los armónicos metálicos
  // característicos de las placas del xilófono.
  xylophone: {
    label: 'Xilófono',
    description: 'Xilófono metálico (FM + decay corto)',
    create: () => new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 7,
      modulationIndex: 8,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.3 },
      modulation: { type: 'square' },
      modulationEnvelope: {
        attack: 0.001, decay: 0.1, sustain: 0, release: 0.2,
      },
    }),
  },
  // Saxofón: MonoSynth saw con ataque lento (legato de viento) +
  // portamento para glissandos + filterEnvelope para el "growl" expresivo.
  saxophone: {
    label: 'Saxofón',
    description: 'Saxofón (saw + filter sweep + slide)',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.4 },
      filterEnvelope: {
        attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.4,
        baseFrequency: 600, octaves: 2.5,
      },
      portamento: 0.08,
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
    // Silenciamos las notas pendientes antes de disponer. silenceSynth
    // prueba releaseAll() (PolySynth, Sampler) o triggerRelease() sin args
    // (Monophonic). Si no hay ninguno, dispose() corta el sonido al
    // desconectar el grafo.
    silenceSynth(currentSynth)
    currentSynth.dispose()
  }
  currentSynth = preset.create()
  // Volumen por defecto -8 dB; los presets pueden sobreescribirlo
  // (p.ej. drums a -4 para destacar en el mix).
  currentSynth.volume.value = preset.volume ?? -8
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

/**
 * Suelta una nota sobre el sintetizador actual.
 *
 * Tone.js tiene dos firmas incompatibles de triggerRelease según la clase:
 *   - PolySynth / Sampler: `triggerRelease(note, time)` — libera solo
 *     la nota especificada (importante al tocar acordes).
 *   - Monophonic (MonoSynth, MembraneSynth, MetalSynth): `triggerRelease(time)`
 *     — acepta SOLO un tiempo, ignora la nota. Si le pasáramos la frecuencia,
 *     Tone.js la interpretaría como segundos y la nota se quedaría sonando
 *     durante horas (bug que ya mordió con bass a 440Hz = "7+ minutos").
 *   - PluckSynth: también `triggerRelease(time)`, corta el pluck activo.
 *
 * Detectamos la diferencia por la presencia de `releaseAll` (que solo
 * tienen los polifónicos). Esto evita hardcodear nombres a medida que
 * añadamos más instrumentos monofónicos (kick, hihat, acid…).
 */
export function releaseNote(midi) {
  if (!currentSynth) return
  const freq = midiToFrequency(midi)

  if (typeof currentSynth.releaseAll === 'function') {
    // Polifónico: libera solo la nota soltada.
    currentSynth.triggerRelease(freq)
  } else if (typeof currentSynth.triggerRelease === 'function') {
    // Monofónico / PluckSynth: triggerRelease(time) — sin args = ahora.
    currentSynth.triggerRelease()
  }
  // Si no hay triggerRelease, la nota decae naturalmente — nada que liberar.
}

/** Silencia todas las notas que estén sonando del sintetizador actual. */
export function releaseAll() {
  if (!currentSynth) return
  silenceSynth(currentSynth)
}

/**
 * Apaga todas las notas de un sintetizador con el mejor método disponible:
 *   - releaseAll() si existe (PolySynth, Sampler).
 *   - triggerRelease() sin args si no (Monophonic: libera el envelope).
 *   - No-op si no hay ninguno (instrumentos sin envelope).
 */
function silenceSynth(synth) {
  if (!synth) return
  if (typeof synth.releaseAll === 'function') {
    synth.releaseAll()
  } else if (typeof synth.triggerRelease === 'function') {
    // Monophonic: triggerRelease(time) — sin args = ahora.
    synth.triggerRelease()
  }
}
