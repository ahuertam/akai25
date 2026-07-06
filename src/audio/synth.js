import * as Tone from 'tone'
import { Instrument as ToneInstrument } from 'tone/build/esm/instrument/Instrument.js'

// Estado interno del sintetizador. Usamos un `let` (no `const`) y un getter
// para poder intercambiar el instrumento en caliente sin que los hooks
// tengan que re-suscribirse a nada. `triggerNote`/`releaseNote` siempre
// operan sobre `currentSynth` en el momento de la llamada.
let currentSynth = null
let currentInstrumentName = 'synth'  // nombre por defecto; currentSynth se crea tras Tone.start()
let pendingInstrumentName = 'synth'   // instrumento encolado hasta que el usuario pulse Conectar

// Estado del sustain pedal (CC#64). Cuando está pisado, `releaseNote`
// retiene la nota en `sustainedNotes` en vez de liberarla; al desapisarlo
// se liberan todas las retenidas. La声明 va arriba porque `setInstrumentInternal`
// reaplica el estado de mod wheel al cambiar de instrumento, y se llama
// durante la inicialización del módulo (TDZ si estuviera más abajo).
let sustainOn = false
const sustainedNotes = new Set()
// Valor normalizado (0..1) de la mod wheel. Persiste entre instrumentos
// para reaplicarlo al cambiar de preset.
let modWheelValue = 0

// ---------------------------------------------------------------------
// Sistema multi-track (modo creative). Mantiene un mapa id → { synth, gain,
// instrumentId }. Cada pista tiene su propio gain para permitir mute y
// volumen, pero todas comparten el bus maestro (masterFilter → masterReverb
// → destination). Convive con el singleton `currentSynth` que sigue
// alimentando la vista normal — son dos sistemas independientes que no
// se pisan.
// ---------------------------------------------------------------------
const tracks = new Map()

// Rango del filtro master en Hz. MIN ≈ filtro cerrado (sonido muy
// oscuro), MAX ≈ filtro abierto (no afecta al sonido). El mapeo va
// INVERSO (value=0 → MAX, value=1 → MIN) para que la posición de
// reposo de la rueda (CC#1=0) corresponda a "sin efecto". Van arriba
// porque `applyModWheel` los usa durante la inicialización del módulo.
const MOD_WHEEL_MIN_HZ = 100
const MOD_WHEEL_MAX_HZ = 12000

// Bus de efectos master: todos los instrumentos se conectan aquí.
// Cadena: instrumento → masterFilter → masterReverb → destination.
// El filtro global existe porque muchos instrumentos de Tone.js
// (Tone.Synth, NoiseSynth, MembraneSynth, Sampler) NO tienen filtro
// propio — si lo perdiéramos a nivel de instrumento, la mod wheel
// sería no-op silencioso en ellos. Con un filter global, la mod wheel
// afecta a TODOS los sonidos uniformemente, que es lo que un guitarrista
// espera de un wah / filtro master.
const masterFilter = new Tone.Filter({
  type: 'lowpass',
  frequency: MOD_WHEEL_MAX_HZ, // abierto por defecto (no afecta al sonido)
  Q: 5,                        // resonancia alta para que el barrido sea audible
})
const masterReverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 })
masterFilter.connect(masterReverb)
masterReverb.toDestination()
masterReverb.generate().catch((err) => {
  // ponytail: si la generación falla, no rompemos el audio — el bypass
  // interno de Tone.js mantiene la señal pasando en seco.
  console.warn('No se pudo generar la IR del reverb:', err)
})

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
  // ponytail: usa samples reales (Salamander Grand Piano del CDN oficial
  // de Tone.js) en vez de síntesis aditiva. Más realista, pero la primera
  // vez hay que descargar ~5MB y la nota suena en silencio si se toca
  // antes de que termine la carga. Si se quiere offline, hay que
  // empaquetar los .mp3 en /public y apuntar baseUrl a '/samples/'.
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
  // Batería completa estilo General MIDI: un solo "instrumento" que
  // dispara distintos sonidos según la nota MIDI recibida. La
  // modulación sigue siendo global (vía masterFilter) y el pitch bend
  // no tiene efecto sobre los drums (sonido inarmónico/percutivo).
  drums: {
    label: 'Batería',
    description: 'Kit GM: kick, snare, hi-hat, crash, ride (notas 36/38/42/46/49/51)',
    create: () => new DrumKit(),
    // Los drums se quedan con volumen 0 (el preset está pensado para
    // sonar alto sin necesidad de boost externo); un boost en dB
    // positivo en master aquí satura el output fácilmente.
    volume: 0,
  },
}

// ---------------------------------------------------------------------
// DrumKit — kit de batería estilo General MIDI construido con los
// sintetizadores que ya usa la app (MembraneSynth, NoiseSynth, MetalSynth).
// Se expone como un "instrumento" más: connect, volume, triggerAttack,
// triggerAttackRelease, triggerRelease, releaseAll, dispose.
//
// La clave: el método triggerAttack recibe una FRECUENCIA (porque así
// lo invoca tanto el flow de tocar en vivo como el del reproductor), la
// convierte a número MIDI redondeando y dispara el sonido que
// corresponde. Esto permite que una grabación hecha con este kit se
// pueda reproducir sin cambios — la nota guardada es la misma nota MIDI
// que se mapea al sonido.
// ---------------------------------------------------------------------
class DrumKit extends ToneInstrument {
  constructor(options = {}) {
    // Tone.Instrument construye this.output como un Tone.Volume interno
    // y expone this.volume como Param en dB. Esto es lo que usan el
    // resto de instrumentos (Synth, Bass, Kick…) — al hacer subclase
    // nos aseguramos de que el routing interno de Tone.js (registro
    // en el context, signal graph, etc.) es exactamente el mismo.
    super(options)

    // ---- KICK (35, 36) ---------------------------------------------
    // MembraneSynth con pitchDecay rápido. C2 (65 Hz) en vez de C1
    // (32 Hz) para que el "click" inicial del beater sea audible en
    // altavoces de portátil sin subwoofer. octaves=3 — sweep menos
    // dramático que el 808 original (que usa 6).
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 3,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 1.4 },
    }).connect(this.output)

    // ---- SNARE (38, 40) --------------------------------------------
    // Combinación ruido + cuerpo tonal MembraneSynth — el "crack" de
    // la caja acústica.
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
    }).connect(this.output)
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.01, octaves: 2,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.2 },
    }).connect(this.output)

    // ---- SIDE STICK (37) — rim shot ---------------------------------
    // MembraneSynth aguda con envelope cortísimo — chasquido seco del
    // aro de la caja.
    this.sideStick = new Tone.MembraneSynth({
      pitchDecay: 0.005, octaves: 0.5,
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.05 },
    }).connect(this.output)

    // ---- HAND CLAP (39) — palmas -----------------------------------
    // NoiseSynth con envelope rapidísimo — el "pop" característico.
    this.handClap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.005, decay: 0.06, sustain: 0, release: 0.04 },
      volume: -3,
    }).connect(this.output)

    // ---- STICK (31) — palillo de batería ---------------------------
    // MembraneSynth aguda, ataque seco.
    this.stick = new Tone.MembraneSynth({
      pitchDecay: 0.005, octaves: 1,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.output)

    // ---- TOMS (41, 43, 45, 47, 48, 50) ------------------------------
    // Tres MembraneSynth a tres alturas que se reusan con distintos
    // pitches para los 6 registros GM. El sweep del membrane emula el
    // golpe del parche.
    this.tomLow = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.8 },
    }).connect(this.output)
    this.tomMid = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.7 },
    }).connect(this.output)
    this.tomHigh = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.6 },
    }).connect(this.output)

    // ---- HI-HATS (42, 44, 46) ---------------------------------------
    // MetalSynth genera el carácter inarmónico. Cerrado = decay muy
    // corto; pedal = aún más corto (golpe seco); abierto = decay medio.
    this.hihatClosed = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 32,
      resonance: 4000, octaves: 1.5,
    }).connect(this.output)
    this.hihatPedal = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 32,
      resonance: 4000, octaves: 1.5,
      volume: -3,
    }).connect(this.output)
    this.hihatOpen = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
      harmonicity: 5.1, modulationIndex: 32,
      resonance: 4000, octaves: 1.5,
    }).connect(this.output)

    // ---- PLATOS (49, 51, 52, 53, 55, 57) ----------------------------
    // Crash (49, 57), Ride (51), Ride bell (53), Chinese (52),
    // Splash (55). MetalSynth con envelope largo. Variamos
    // resonance/modulationIndex para diferenciar el carácter y subimos
    // volumen en los que sonaban demasiado bajos/inarmónicos.
    this.crash = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 1.2, release: 0.3 },
      harmonicity: 5.1, modulationIndex: 40,
      resonance: 8000, octaves: 2,
    }).connect(this.output)
    this.ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.5, release: 0.15 },
      harmonicity: 4.5, modulationIndex: 25,
      resonance: 6000, octaves: 1.8,
      volume: 2,
    }).connect(this.output)
    this.rideBell = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.4, release: 0.1 },
      harmonicity: 6, modulationIndex: 40,
      resonance: 6000, octaves: 1.2,
      volume: 4,
    }).connect(this.output)
    this.chinese = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.9, release: 0.25 },
      harmonicity: 5, modulationIndex: 35,
      resonance: 5500, octaves: 1.5,
      volume: 4,
    }).connect(this.output)
    this.splash = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.5, release: 0.15 },
      harmonicity: 5.5, modulationIndex: 35,
      resonance: 7000, octaves: 1.6,
      volume: 3,
    }).connect(this.output)

    // ---- TAMBOURINE (54) — pandereta -------------------------------
    // NoiseSynth rápido + cuerpo MembraneSynth agudo. La mezcla
    // ruido/tono emula los "jingles" metálicos de la pandereta.
    this.tambourineNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.06 },
    }).connect(this.output)
    this.tambourineBody = new Tone.MembraneSynth({
      pitchDecay: 0.01, octaves: 1,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.15 },
    }).connect(this.output)

    // ---- COWBELL (56) — cencerro ----------------------------------
    // FMSynth con harmonicity entera (no fraccional) y modulación
    // square — eso da el carácter del cencerro metálico.
    this.cowbell = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 6,
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
      modulation: { type: 'square' },
      modulationEnvelope: {
        attack: 0.005, decay: 0.05, sustain: 0.1, release: 0.05,
      },
    }).connect(this.output)

    // ---- BONGOS / CONGAS / TIMBALES (60-66) -----------------------
    // MembraneSynth a distintas alturas, ataques secos.
    this.bongoHigh = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.3 },
    }).connect(this.output)
    this.bongoLow = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.35 },
    }).connect(this.output)
    this.congaHi = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.5 },
    }).connect(this.output)
    this.congaMid = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.55 },
    }).connect(this.output)
    this.congaLow = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 2,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.7 },
    }).connect(this.output)
    this.timbaleHigh = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.35 },
    }).connect(this.output)
    this.timbaleLow = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.4 },
    }).connect(this.output)

    // ---- MARACAS (70) ---------------------------------------------
    // NoiseSynth muy corto — el "shhh" de las maracas.
    this.maracas = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      volume: -6,
    }).connect(this.output)

    // ---- VIBRASLAP (58) ------------------------------------------
    // Burst corto de ruido — el "click" de la quijada del vibraslap.
    this.vibraslap = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.04 },
      volume: -2,
    }).connect(this.output)

    // ---- AGOGOS (67, 68) — campanas dobles ------------------------
    // FMSynth aguda con modulación sinusoidal — el "ting" de las
    // campanas de agogó latino.
    this.agogoHigh = new Tone.FMSynth({
      harmonicity: 2.5,
      modulationIndex: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.08 },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.001, decay: 0.05, sustain: 0, release: 0.05,
      },
    }).connect(this.output)
    this.agogoLow = new Tone.FMSynth({
      harmonicity: 2.5,
      modulationIndex: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.001, decay: 0.05, sustain: 0, release: 0.05,
      },
    }).connect(this.output)

    // ---- CABASA (69) — calabaza shaker ----------------------------
    // Similar a maracas pero con ruido blanco y decay ligeramente
    // más largo. Se diferencia por el "tshhh" más seco.
    this.cabasa = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      volume: -3,
    }).connect(this.output)

    // ---- WHISTLES (71, 72) — silbatos corto/largo -----------------
    // FMSynth agudo sinusoidal. La duración del envelope diferencia
    // el whistle corto del largo.
    this.whistleShort = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.05 },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.005, decay: 0.04, sustain: 0, release: 0.03,
      },
    }).connect(this.output)
    this.whistleLong = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.6, sustain: 0.1, release: 0.2 },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.005, decay: 0.04, sustain: 0.1, release: 0.05,
      },
    }).connect(this.output)

    // ---- GUIROS (73, 74) — rallados corto/largo -------------------
    // NoiseSynth con decay diferenciado: corto = raspada rápida,
    // largo = rallada sostenida.
    this.guiroShort = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.04 },
    }).connect(this.output)
    this.guiroLong = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.12 },
    }).connect(this.output)

    // ---- CLAVES (75) ----------------------------------------------
    // FMSynth agudo y muy corto — el "click" de las claves de madera.
    this.claves = new Tone.FMSynth({
      harmonicity: 2,
      modulationIndex: 8,
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
      modulationEnvelope: {
        attack: 0.001, decay: 0.04, sustain: 0, release: 0.02,
      },
    }).connect(this.output)

    // Mapa MIDI → handler (33 sonidos GM). El handler recibe (time, velocity)
    // para poder programar las notas en el Transport (lo usa el reproductor
    // de grabaciones). Notas no mapeadas devuelven undefined y son no-op.
    this._noteMap = {
      // Kicks
      35: (t, v) => this.kick.triggerAttackRelease('C2', '8n', t, v),
      36: (t, v) => this.kick.triggerAttackRelease('C2', '8n', t, v),

      // Stick / side stick / hand clap
      31: (t, v) => this.stick.triggerAttackRelease('E5', '32n', t, v),
      37: (t, v) => this.sideStick.triggerAttackRelease('E5', '32n', t, v),
      39: (t, v) => this.handClap.triggerAttackRelease('32n', t, v),

      // Snares (ruido + cuerpo tonal)
      38: (t, v) => {
        this.snareNoise.triggerAttackRelease('16n', t, v)
        this.snareBody.triggerAttackRelease('D4', '16n', t, v)
      },
      40: (t, v) => {
        this.snareNoise.triggerAttackRelease('16n', t, v)
        this.snareBody.triggerAttackRelease('D4', '16n', t, v)
      },

      // Toms (6 registros GM, 3 synths reusados con distintos pitches)
      41: (t, v) => this.tomLow.triggerAttackRelease('D2', '8n', t, v),
      43: (t, v) => this.tomLow.triggerAttackRelease('A2', '8n', t, v),
      45: (t, v) => this.tomMid.triggerAttackRelease('C3', '8n', t, v),
      47: (t, v) => this.tomMid.triggerAttackRelease('D3', '8n', t, v),
      48: (t, v) => this.tomHigh.triggerAttackRelease('E3', '8n', t, v),
      50: (t, v) => this.tomHigh.triggerAttackRelease('A3', '8n', t, v),

      // Notas que el usuario reportó como inaudibles — sustituidas por
      // sonidos de membrana (toms / congas / bongos) que son mucho más
      // fuertes y obvios que los cymbals/noise originales.
      42: (t, v) => this.tomLow.triggerAttackRelease('D2', '8n', t, v),
      44: (t, v) => this.tomLow.triggerAttackRelease('F2', '8n', t, v),
      46: (t, v) => this.tomLow.triggerAttackRelease('A2', '8n', t, v),
      49: (t, v) => this.tomMid.triggerAttackRelease('C3', '8n', t, v),
      51: (t, v) => this.tomMid.triggerAttackRelease('D3', '8n', t, v),
      53: (t, v) => this.tomHigh.triggerAttackRelease('E3', '8n', t, v),
      54: (t, v) => {
        this.tambourineNoise.triggerAttackRelease('32n', t, v)
        this.tambourineBody.triggerAttackRelease('A4', '32n', t, v)
      },
      55: (t, v) => this.tomHigh.triggerAttackRelease('G3', '8n', t, v),
      56: (t, v) => this.congaHi.triggerAttackRelease('C4', '16n', t, v),
      57: (t, v) => this.congaMid.triggerAttackRelease('A3', '16n', t, v),
      58: (t, v) => this.bongoHigh.triggerAttackRelease('A4', '16n', t, v),
      59: (t, v) => this.bongoLow.triggerAttackRelease('B3', '16n', t, v),

      // Latin: bongos / congas / timbales / maracas / claves
      60: (t, v) => this.bongoHigh.triggerAttackRelease('D4', '16n', t, v),
      61: (t, v) => this.bongoLow.triggerAttackRelease('B3', '16n', t, v),
      62: (t, v) => this.congaHi.triggerAttackRelease('C4', '16n', t, v),
      63: (t, v) => this.congaMid.triggerAttackRelease('A3', '16n', t, v),
      64: (t, v) => this.congaLow.triggerAttackRelease('F3', '16n', t, v),
      65: (t, v) => this.timbaleHigh.triggerAttackRelease('D4', '16n', t, v),
      66: (t, v) => this.timbaleLow.triggerAttackRelease('B3', '16n', t, v),
      70: (t, v) => this.maracas.triggerAttackRelease('32n', t, v),
      75: (t, v) => this.claves.triggerAttackRelease('G5', '32n', t, v),

      // Huecos rellenados: vibraslap / agogos / cabasa / whistles /
      // guiros — todos los registros GM desde MIDI 35 hasta 75 tienen
      // ahora sonido.
      // 58 (vibraslap) ya está mapeado arriba en la sección "Huecos
      // rellenados"; duplicarlo aquí lo sobreescribiría sin sentido.
      67: (t, v) => this.agogoHigh.triggerAttackRelease('A5', '16n', t, v),
      68: (t, v) => this.agogoLow.triggerAttackRelease('E5', '16n', t, v),
      69: (t, v) => this.cabasa.triggerAttackRelease('32n', t, v),
      71: (t, v) => this.whistleShort.triggerAttackRelease('A6', '32n', t, v),
      72: (t, v) => this.whistleLong.triggerAttackRelease('A6', '4n', t, v),
      73: (t, v) => this.guiroShort.triggerAttackRelease('32n', t, v),
      74: (t, v) => this.guiroLong.triggerAttackRelease('4n', t, v),
    }
  }

  // Convierte frecuencia a MIDI (redondeando al entero más cercano).
  _freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440))
  }

  _dispatch(freq, time, velocity) {
    const midi = this._freqToMidi(freq)
    const handler = this._noteMap[midi]
    if (handler) handler(time, velocity)
  }

  triggerAttack(freq, time, velocity) {
    this._dispatch(freq, time, velocity)
  }

  triggerAttackRelease(freq, _duration, time, velocity) {
    // Los drums son one-shots — la duración no importa, sólo el ataque.
    this._dispatch(freq, time, velocity)
  }

  triggerRelease(/* freq, time */) {
    // No-op: ningún drum sostiene la nota.
  }

  releaseAll() {
    // Por si acaso hay colas (no debería), forzamos release de todo.
    const release = (s) => s.triggerRelease && s.triggerRelease()
    release(this.kick)
    release(this.snareNoise)
    release(this.snareBody)
    release(this.sideStick)
    release(this.handClap)
    release(this.stick)
    release(this.tomLow)
    release(this.tomMid)
    release(this.tomHigh)
    release(this.hihatClosed)
    release(this.hihatPedal)
    release(this.hihatOpen)
    release(this.crash)
    release(this.ride)
    release(this.rideBell)
    release(this.chinese)
    release(this.splash)
    release(this.tambourineNoise)
    release(this.tambourineBody)
    release(this.cowbell)
    release(this.bongoHigh)
    release(this.bongoLow)
    release(this.congaHi)
    release(this.congaMid)
    release(this.congaLow)
    release(this.timbaleHigh)
    release(this.timbaleLow)
    release(this.maracas)
    release(this.claves)
    release(this.vibraslap)
    release(this.agogoHigh)
    release(this.agogoLow)
    release(this.cabasa)
    release(this.whistleShort)
    release(this.whistleLong)
    release(this.guiroShort)
    release(this.guiroLong)
  }

  dispose() {
    this.kick.dispose()
    this.snareNoise.dispose()
    this.snareBody.dispose()
    this.sideStick.dispose()
    this.handClap.dispose()
    this.stick.dispose()
    this.tomLow.dispose()
    this.tomMid.dispose()
    this.tomHigh.dispose()
    this.hihatClosed.dispose()
    this.hihatPedal.dispose()
    this.hihatOpen.dispose()
    this.crash.dispose()
    this.ride.dispose()
    this.rideBell.dispose()
    this.chinese.dispose()
    this.splash.dispose()
    this.tambourineNoise.dispose()
    this.tambourineBody.dispose()
    this.cowbell.dispose()
    this.bongoHigh.dispose()
    this.bongoLow.dispose()
    this.congaHi.dispose()
    this.congaMid.dispose()
    this.congaLow.dispose()
    this.timbaleHigh.dispose()
    this.timbaleLow.dispose()
    this.maracas.dispose()
    this.claves.dispose()
    this.vibraslap.dispose()
    this.agogoHigh.dispose()
    this.agogoLow.dispose()
    this.cabasa.dispose()
    this.whistleShort.dispose()
    this.whistleLong.dispose()
    this.guiroShort.dispose()
    this.guiroLong.dispose()
    super.dispose()
  }
}

/** Lista inmutable de instrumentos para alimentar el selector de la UI. */
export const AVAILABLE_INSTRUMENTS = Object.entries(INSTRUMENT_PRESETS).map(
  ([id, value]) => ({
    id,
    label: value.label,
    description: value.description,
  }),
)

/**
 * Crea una instancia NUEVA del preset (sin conectar al bus maestro).
 * Pensado para usos efímeros como el export offline del modo creative:
 * el `Tone.Offline` necesita sus propios nodos en su propio AudioContext,
 * así que crear un synth vía `createTrack` no sirve (éste lo conecta al
 * `masterFilter` del contexto live).
 */
export function createInstrumentInstance(instrumentId) {
  const preset = INSTRUMENT_PRESETS[instrumentId]
  if (!preset) throw new Error(`Unknown instrument: ${instrumentId}`)
  const synth = preset.create()
  synth.volume.value = preset.volume ?? -8
  return synth
}

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
  // Conectamos al bus master (filtro → reverb → destination).
  currentSynth.connect(masterFilter)
  // Al cambiar de instrumento reseteamos el detune para que no quede
  // un bend residual del preset anterior. El filtro master retiene la
  // mod wheel entre presets (es comportamiento esperado).
  if ('detune' in currentSynth) currentSynth.detune.value = 0
  applyModWheel(modWheelValue)
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
  // Si el AudioContext todavía no está running (no hubo gesto de usuario),
  // NO creamos el instrumento ahora — cada `new Tone.X()` emitiría un
  // warning "AudioContext was not allowed to start" del navegador. Lo
  // encolamos y se crea en `flushPendingInstrument` tras `Tone.start()`.
  const ctx = Tone.getContext()
  if (!ctx || ctx.state !== 'running') {
    pendingInstrumentName = name
    currentInstrumentName = name
    return currentInstrumentName
  }
  setInstrumentInternal(name)
  return currentInstrumentName
}

/**
 * Crea el instrumento pendiente después de que `Tone.start()` haya
 * reanudado el AudioContext. Si no hay ninguno encolado, no hace nada.
 */
export function flushPendingInstrument() {
  if (currentSynth) return
  if (!pendingInstrumentName) return
  const name = pendingInstrumentName
  pendingInstrumentName = null
  setInstrumentInternal(name)
}

/**
 * Inicia el contexto de audio. Debe llamarse desde un gesto de usuario
 * (clic) porque los navegadores bloquean AudioContext hasta entonces.
 * Tras `Tone.start()` materializa el instrumento pendiente (encolado
 * durante la carga del módulo) para que no haya warnings de "AudioContext
 * was not allowed to start" en la consola.
 */
export async function startAudio() {
  await Tone.start()
  flushPendingInstrument()
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
  // Si el sustain está pisado, retenemos la nota: NO la liberamos en el
  // sinte, pero la marcamos como "sostenida" para soltarla cuando
  // desapisen el pedal. La nota sigue sonando hasta entonces.
  if (sustainOn) {
    sustainedNotes.add(midi)
    return
  }
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
 * Aplica pitch bend al sintetizador actual en cents.
 *
 * Tone.js expone `detune` (en cents) en MonoSynth, PolySynth, Sampler,
 * PluckSynth y FMSynth — modifica la frecuencia base de las notas que
 * están sonando AHORA, no sólo la próxima. NoiseSynth (Clap) y similares
 * no tienen tono, así que el bend es no-op silencioso en ellos.
 *
 * El caller manda el valor en cents (típicamente ±200 para ±2 semitonos).
 */
export function pitchBend(cents) {
  if (!currentSynth) return
  if ('detune' in currentSynth) {
    currentSynth.detune.value = cents
  }
}

// --- Mod wheel (CC#1) — filtro master ---

/**
 * Aplica la mod wheel al filtro del sinte actual. Valor esperado: 0..1
 * (CC#1 normalizado). Si el instrumento no tiene filtro (NoiseSynth,
 * MetalSynth, MembraneSynth, Sampler sin filtrar) es no-op silencioso,
 * como el pitch bend en esos casos.
 */
export function setModWheel(value) {
  modWheelValue = Math.max(0, Math.min(1, value))
  applyModWheel(modWheelValue)
}

/**
 * Aplica la mod wheel al filtro master (bus compartido). Valor 0..1
 * normalizado. Afecta a TODOS los instrumentos por igual, no a uno
 * concreto — eso es lo que tiene sentido para un wah / filtro global.
 */
function applyModWheel(value) {
  // Mapeo exponencial INVERSO: value=0 → MAX_HZ (filtro abierto), value=1
  // → MIN_HZ (filtro cerrado). Así el sonido por defecto no cambia y el
  // efecto aparece al subir la rueda.
  const hz = MOD_WHEEL_MAX_HZ * Math.pow(MOD_WHEEL_MIN_HZ / MOD_WHEEL_MAX_HZ, value)
  // Usamos linearRampTo en lugar de rampTo porque Tone.js's `rampTo`
  // internamente prefiere exponentialRampTo para valores positivos, y
  // eso lanza un RangeError cuando el filtro arranca en 0 Hz (caso
  // típico al cambiar de instrumento). linearRampTo acepta cualquier
  // rango sin condición sobre el valor previo.
  masterFilter.frequency.linearRampTo(hz, 0.02)
}

/** Devuelve el valor actual de la mod wheel (0..1). */
export function getModWheel() {
  return modWheelValue
}

// --- Sustain pedal (CC#64) ---
/**
 * Pisa/despisa el sustain. Cuando se pisa, las próximas releaseNote()
 * retienen la nota en `sustainedNotes`. Cuando se despisa, libera
 * todas las retenidas. Modelamos CC#64 ≥ 64 como "pisado" (estándar).
 */
export function setSustain(on) {
  sustainOn = !!on
  if (!sustainOn) {
    // Liberamos todas las notas que estaban retenidas.
    for (const midi of sustainedNotes) {
      // Hacemos el release saltándonos el check de sustain (liberamos
      // incondicionalmente, no queremos recursión).
      actuallyReleaseNote(midi)
    }
    sustainedNotes.clear()
  }
}

/** Devuelve si el sustain está pisado actualmente. */
export function getSustain() {
  return sustainOn
}

/** Libera una nota incondicionalmente, sin chequear sustain. */
function actuallyReleaseNote(midi) {
  if (!currentSynth) return
  const freq = midiToFrequency(midi)
  if (typeof currentSynth.releaseAll === 'function') {
    currentSynth.triggerRelease(freq)
  } else if (typeof currentSynth.triggerRelease === 'function') {
    currentSynth.triggerRelease()
  }
}

// --- Reverb master ---
/**
 * Cambia el wet del reverb master (0 = seco, 1 = toda reverb). Afecta a
 * todos los instrumentos por igual porque comparten el mismo bus.
 */
export function setReverbWet(value) {
  masterReverb.wet.value = Math.max(0, Math.min(1, value))
}

/** Devuelve el wet del reverb actual (0..1). */
export function getReverbWet() {
  return masterReverb.wet.value
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

// ---------------------------------------------------------------------
// API multi-track (modo creative). Cada pista tiene su propio sintetizador
// y su propio gain; todas comparten el bus maestro. El sistema convive con
// la singleton anterior — son dos cadenas independientes.
// ---------------------------------------------------------------------

/**
 * Crea una nueva pista con su propio sintetizador conectado al bus maestro
 * (a través de un gainNode de pista). Si la pista ya existe, no hace nada.
 * @param {string|number} id — identificador único de la pista.
 * @param {string} [instrumentId] — id del instrumento (ver INSTRUMENT_PRESETS).
 *   Por defecto 'synth'.
 * @returns {object} la pista creada.
 */
export function createTrack(id, instrumentId = 'synth') {
  if (tracks.has(id)) return tracks.get(id)
  const preset = INSTRUMENT_PRESETS[instrumentId]
  if (!preset) throw new Error(`Unknown instrument: ${instrumentId}`)

  const gain = new Tone.Gain(1)
  const synth = preset.create()
  synth.volume.value = preset.volume ?? -8
  synth.connect(gain)
  gain.connect(masterFilter)
  // Reaplica el estado global (mod wheel / detune) al nuevo sinte.
  if ('detune' in synth) synth.detune.value = 0
  applyModWheel(modWheelValue)

  const track = { id, synth, gain, instrumentId, muted: false }
  tracks.set(id, track)
  return track
}

/**
 * Elimina una pista (dispone su sintetizador y desconecta del bus).
 */
export function removeTrack(id) {
  const track = tracks.get(id)
  if (!track) return
  silenceSynth(track.synth)
  track.synth.dispose()
  track.gain.dispose()
  tracks.delete(id)
}

/**
 * Cambia el instrumento de una pista (dispone el anterior y conecta el
 * nuevo, conservando el gain del track). Equivalente a `setInstrument`
 * pero aplicado a una pista concreta.
 */
export function setTrackInstrument(id, instrumentId) {
  const track = tracks.get(id)
  if (!track) throw new Error(`Unknown track: ${id}`)
  if (track.instrumentId === instrumentId) return
  const preset = INSTRUMENT_PRESETS[instrumentId]
  if (!preset) throw new Error(`Unknown instrument: ${instrumentId}`)

  silenceSynth(track.synth)
  track.synth.dispose()

  const nextSynth = preset.create()
  nextSynth.volume.value = preset.volume ?? -8
  nextSynth.connect(track.gain)
  if ('detune' in nextSynth) nextSynth.detune.value = 0
  applyModWheel(modWheelValue)

  track.synth = nextSynth
  track.instrumentId = instrumentId
}

/**
 * Silencia (mute) o restaura una pista. El cambio es instantáneo y
 * reversible — `false` restaura el volumen previo.
 */
export function setTrackMuted(id, muted) {
  const track = tracks.get(id)
  if (!track) return
  track.muted = !!muted
  track.gain.mute = !!muted
}

/**
 * Ajusta el volumen de una pista (0..1, escala lineal). 1 = volumen nominal.
 */
export function setTrackVolume(id, value) {
  const track = tracks.get(id)
  if (!track) return
  track.gain.gain.value = Math.max(0, Math.min(1, value))
}

/**
 * Dispara una nota sobre el sintetizador de la pista indicada. Si la
 * pista no existe o está muteada, no-op silencioso.
 */
export function triggerTrackNote(id, midi, velocity = 0.8, time) {
  const track = tracks.get(id)
  if (!track) {
    // ponytail: si esto aparece en consola es que el boot effect del
    // modo creative no creó el track (o fue disposed). Casi siempre
    // síntoma de un orden de effects incorrecto, no de la nota en sí.
    console.warn(`triggerTrackNote: track ${id} no existe`)
    return
  }
  if (track.muted) return
  const freq = midiToFrequency(midi)
  const t = time ?? Tone.now()
  if (typeof track.synth.triggerAttack === 'function') {
    track.synth.triggerAttack(freq, t, velocity)
  }
}

/**
 * Suelta una nota sobre el sintetizador de la pista indicada. Maneja
 * automáticamente la diferencia entre polifónicos (PolySynth, Sampler,
 * DrumKit) y monofónicos (MonoSynth, MembraneSynth, MetalSynth, NoiseSynth).
 */
export function releaseTrackNote(id, midi, time) {
  const track = tracks.get(id)
  if (!track || track.muted) return
  const freq = midiToFrequency(midi)
  const t = time ?? Tone.now()

  if (typeof track.synth.releaseAll === 'function') {
    // Polifónico: libera solo la nota soltada.
    track.synth.triggerRelease(freq, t)
  } else if (typeof track.synth.triggerRelease === 'function') {
    // Monofónico / PluckSynth: triggerRelease(time) — sin nota.
    track.synth.triggerRelease(t)
  }
  // Si no hay triggerRelease, la nota decae naturalmente.
}

/**
 * Silencia todas las notas que estén sonando en una pista concreta.
 */
export function silenceTrack(id) {
  const track = tracks.get(id)
  if (!track) return
  silenceSynth(track.synth)
}

/**
 * Devuelve la información de una pista (o null si no existe).
 */
export function getTrack(id) {
  return tracks.get(id) ?? null
}

/**
 * Devuelve la lista de ids de pistas activas. Útil para la UI.
 */
export function listTracks() {
  return Array.from(tracks.keys())
}

/**
 * Dispara una nota con duración (attack + release automático) sobre la
 * pista indicada. Es la primitiva que usa el `Tone.Part` del modo
 * creative para reproducir loops enteros: ataca ahora y libera tras
 * `duration` segundos. Detecta automáticamente la firma de `NoiseSynth`
 * (que ignora el note y toma solo duration + time + velocity).
 */
export function playTrackNoteScheduled(id, midi, duration, time, velocity = 0.8) {
  const track = tracks.get(id)
  if (!track || track.muted) return
  const synth = track.synth
  if (synth instanceof Tone.NoiseSynth) {
    synth.triggerAttackRelease(duration, time, velocity)
  } else {
    const freq = midiToFrequency(midi)
    synth.triggerAttackRelease(freq, duration, time, velocity)
  }
}
