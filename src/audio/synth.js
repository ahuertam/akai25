import * as Tone from 'tone'
import { Instrument as ToneInstrument } from 'tone/build/esm/instrument/Instrument.js'
import { midiToNoteName } from '../utils/notes.js'

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

// ponytail: presets basados en samples reales (carpeta public/samples/
// — movidos desde src/audio/samples para que Vite los sirva como
// estáticos). Cada Tone.Sampler mapea archivos a MIDI notes
// consecutivas empezando en C2 (MIDI 36). El usuario toca diferentes
// notas para escuchar diferentes samples. Las listas de archivos
// están hardcoded (import.meta.glob requiere path literal y el
// bundle sería enorme con 200+ paths). Definidas ANTES de
// INSTRUMENT_PRESETS para que estén en scope cuando se evalúa el
// object literal (de lo contrario TDZ → ReferenceError en runtime).
const ACE_FILES = [
  'CLAVE.WAV', 'HHCL.WAV', 'HHOP.WAV',
  'KICK1.WAV', 'KICK2.WAV', 'KICK3.WAV',
  'PERC1.WAV', 'PERC2.WAV', 'PERC3.WAV', 'PERC4.WAV', 'PERC5.WAV', 'PERC6.WAV', 'PERC7.WAV',
  'SNARE1.WAV', 'SNARE2.WAV', 'SNARE3.WAV',
]

const MPC2000_FILES = [
  '808_HH__CL.wav', '808_HH__OP.wav', '808_KICK.wav', '808_LNG_KICK.wav', '808_SNARE.wav',
  'CRASH__1.wav', 'CRASH_CYM.wav', 'EFEX_CY02_SA.wav',
  'F_CLAP_1.wav', 'F_CLAP_2.wav', 'HH_THIN.wav', 'HH_THIN__OP.wav',
  'HIP_HH_1.wav', 'HIP_KICK.wav', 'HIP_LHH.wav', 'HIP_SN_7.wav', 'HIP_S_SN.wav',
  'HOUC_TOM__SA.wav', 'KICK_F.wav', 'KICK_OF_1B.wav',
  'M16_RIDE.wav', 'MHBB_SN.wav',
  'NEW_FX1TOM.wav', 'NORI_SN_0.wav', 'NR_CRS_A.wav', 'NR_HH_C_A1.wav', 'NR_HH_L_A5.wav',
  'NR_SPLASH.wav', 'NR_TOM_F.wav', 'NR_TOM_H.wav', 'NR_TOM_L.wav', 'NR_TOM_M.wav',
  'P_SN_RIM.wav', 'PW_MIX_SD02S.wav', 'RESO_CYN_1.wav', 'REV_SLAP.wav',
  'ST_AMBSN7.wav', 'SY_TOM_1.wav', 'THIN_CRASH1.wav', 'THIN_HH_FT.wav', 'THIN_RIDE.wav',
  'TT_HH12_F8.wav',
]

const NES_FILES = [
  'BM Sound 6.wav', 'BM Sound 7.wav', 'BM Sound 8.wav',
  'CO Sound 31.wav', 'CO Sound 32.wav', 'CO Sound 33.wav',
  'CV Sound 18.wav', 'CV Sound 19.wav', 'CV Sound 25.wav',
  'FF Sound 39.wav',
  'GO Sound 44.wav', 'GO Sound 45.wav', 'GO Sound 46.wav',
  'LZ Sound 52.wav', 'LZ Sound 54.wav', 'LZ Sound 55.wav', 'LZ Sound 552.wav',
  'LZ Sound 56.wav', 'LZ Sound 57.wav',
  'MA Sound 100.wav', 'MA Sound 96.wav', 'MA Sound 97.wav', 'MA Sound 98.wav', 'MA Sound 99.wav',
  'ME Sound 74.wav', 'ME Sound 77.wav', 'ME Sound 78.wav', 'ME Sound 81.wav',
  'MM Sound 62.wav', 'MM Sound 63.wav', 'MM Sound 64.wav', 'MM Sound 65.wav', 'MM Sound 66.wav',
  'MM Sound 67.wav', 'MM Sound 69.wav', 'MM Sound 70.wav',
  'NG Sound 90.wav', 'NG Sound 91.wav', 'NG Sound 92.wav',
  'PB Sound 94.wav',
  'PO Sound 83.wav', 'PO Sound 84.wav', 'PO Sound 85.wav', 'PO Sound 86.wav', 'PO Sound 87.wav',
  'PO Sound 88.wav', 'PO Sound 89.wav',
]

const PTX8_FILES = [
  'BDrum1.wav', 'BDrum2.wav',
  'Bongo1.wav', 'Bongo2.wav',
  'Clap.wav',
  'Conga1.wav', 'Conga2.wav',
  'Cowbell.wav',
  'Crash.wav',
  'CymRide.wav',
  'Funky1.wav', 'Funky2.wav', 'Funky3.wav',
  'HighTom1.wav', 'HighTom2.wav', 'HighTom3.wav',
  'Hihat1.wav', 'Hihat2.wav', 'Hihat3.wav',
  'Jamblock1.wav', 'Jamblock2.wav',
  'LowTom1.wav', 'LowTom2.wav', 'LowTom3.wav',
  'MidTom1.wav', 'MidTom2.wav', 'MidTom3.wav',
  'Noise.WAV',
  'RimSlap.wav',
  'Snare1.wav', 'Snare2.wav', 'Snare3.WAV', 'Snare4.WAV',
  'TimbaleHigh.wav', 'TimbaleLow.wav', 'TimbaleMid.wav',
]

// ponytail: SDS2000 tiene 8 subcarpetas × 5 tipos = 40 samples en un
// solo Sampler. Detalle importante: los nombres de archivo tienen
// ESPACIO entre "SDS2000" y el tipo ("SDS2000 BD1.wav", NO
// "SDS2000_BD1.wav"). Y la extensión cambia de `.wav` a `.WAV` a
// partir de Factory3. Si el path no coincide exacto, el Sampler hace
// 404 silencioso y no suena nada — de ahí "no se oye nada en sds2000".
const SDS2000_FILES = (() => {
  const out = []
  for (let f = 1; f <= 8; f++) {
    const prefix = `SDS2000_Factory${f}/`
    // Factory1-2 son .wav (lowercase); Factory3-8 son .WAV.
    const ext = f <= 2 ? 'wav' : 'WAV'
    for (const stem of ['BD', 'HT', 'LT', 'MT', 'SN']) {
      out.push(`${prefix}SDS2000 ${stem}${f}.${ext}`)
    }
  }
  return out
})()

const SIMMONS_FILES = Array.from(
  { length: 25 },
  (_, i) => `${String(i + 1).padStart(2, '0')}.wav`,
)

const SPECDRUM_FILES = [
  'afro_1_trunk.wav', 'afro_2_buash.wav', 'afro_3_hiconga.wav', 'afro_4_loconga.wav',
  'afro_5_clave.wav', 'afro_6_coconut.wav', 'afro_7_guiro.wav', 'afro_8_whistle.wav',
  'electro_1_e_kick.wav', 'electro_2_e_snare.wav', 'electro_3_e_mitom.wav', 'electro_4_e_lotom.wav',
  'electro_5_e_peow.wav', 'electro_6_e_hihat.wav', 'electro_7_e_cymb.wav', 'electro_8_e_clap.wav',
  'latin_1_kick_d.wav', 'latin_2_snare_h.wav', 'latin_3_hi_timb.wav', 'latin_4_lo_timb.wav',
  'latin_5_handcow.wav', 'latin_6_stick.wav', 'latin_7_cabrash.wav', 'latin_8_tambori.wav',
  'orig_1_kick.wav', 'orig_2_snare.wav', 'orig_3_mid_tom.wav', 'orig_4_low_tom.wav',
  'orig_5_cowbell.wav', 'orig_6_hihat_c.wav', 'orig_7_hihat_o.wav', 'orig_8_clap.wav',
]

const ASR_X_FILES = [ // ponytail: sampler mapea hasta 84 archivos — los extras no se cargan
  'ASR-X Crash 1.wav',
  'ASR-X Hat 01.wav',
  'ASR-X Hat 02.wav',
  'ASR-X Hat 03.wav',
  'ASR-X Hat 04.wav',
  'ASR-X Hat 05.wav',
  'ASR-X Hat 06.wav',
  'ASR-X Hat 07.wav',
  'ASR-X Hat 08.wav',
  'ASR-X Hat 09.wav',
  'ASR-X Hat 10.wav',
  'ASR-X Hat 11.wav',
  'ASR-X Hat 12.wav',
  'ASR-X Hat 13.wav',
  'ASR-X Hat 14.wav',
  'ASR-X Hat 15.wav',
  'ASR-X Hat 16.wav',
  'ASR-X Kick 01.wav',
  'ASR-X Kick 02.wav',
  'ASR-X Kick 03.wav',
  'ASR-X Kick 04.wav',
  'ASR-X Kick 05.wav',
  'ASR-X Kick 06.wav',
  'ASR-X Kick 07.wav',
  'ASR-X Kick 08.wav',
  'ASR-X Kick 09.wav',
  'ASR-X Kick 10.wav',
  'ASR-X Kick 11.wav',
  'ASR-X Kick 12.wav',
  'ASR-X Kick 13.wav',
  'ASR-X Kick 14.wav',
  'ASR-X Kick 15.wav',
  'ASR-X Kick 16.wav',
  'ASR-X Kick 17.wav',
  'ASR-X Kick 18.wav',
  'ASR-X Kick 19.wav',
  'ASR-X Kick 20.wav',
  'ASR-X Kick 21.wav',
  'ASR-X Kick 22.wav',
  'ASR-X Kick 23.wav',
  'ASR-X Kick 24.wav',
  'ASR-X Kick 25.wav',
  'ASR-X Ride 01.wav',
  'ASR-X Ride 02.wav',
  'ASR-X Ride 03.wav',
  'ASR-X Ride 04.wav',
  'ASR-X Snare 01.wav',
  'ASR-X Snare 02.wav',
  'ASR-X Snare 03.wav',
  'ASR-X Snare 04.wav',
  'ASR-X Snare 05.wav',
  'ASR-X Snare 06.wav',
  'ASR-X Snare 07.wav',
  'ASR-X Snare 08.wav',
  'ASR-X Snare 09.wav',
  'ASR-X Snare 10.wav',
  'ASR-X Snare 11.wav',
  'ASR-X Snare 12.wav',
  'ASR-X Snare 13.wav',
  'ASR-X Snare 14.wav',
  'ASR-X Snare 15.wav',
  'ASR-X Snare 16.wav',
  'ASR-X Snare 17.wav',
  'ASR-X Snare 18.wav',
  'ASR-X Snare 19.wav',
  'ASR-X Snare 20.wav',
  'ASR-X Snare 21.wav',
  'ASR-X Snare 22.wav',
  'ASR-X Snare 23.wav',
  'ASR-X Snare 24.wav',
  'ASR-X Snare 25.wav',
  'ASR-X Snare 26.wav',
  'ASR-X Snare 27.wav',
  'ASR-X Snare 28.wav',
  'ASR-X Snare 29.wav',
  'ASR-X Snare 30.wav',
  'ASR-X Snare 31.wav',
  'ASR-X Snare 32.wav',
  'ASR-X Snare 33.wav',
  'ASR-X Snare 34.wav',
  'ASR-X Snare 35.wav',
  'ASR-X Snare 36.wav',
  'ASR-X Snare 37.wav',
  'ASR-X Snare 38.wav',
  'ASR-X Snare 39.wav',
  'ASR-X Snare 40.wav',
]

// ponytail: omitido — el folder ClapTrap/ es un duplicado exacto
// (mismos 25 .wav, mismos MD5) del folder Simmons_ClapTrap/ ya
// registrado como preset `simmons`. Agregarlo crearía un alias inútil.

const CR7030_FILES = [
  'bongo7030.wav',
  'clave7030.wav',
  'guirolong7030.wav',
  'guiroshort7030.wav',
  'hatclosed7030.wav',
  'hatopen7030.wav',
  'kick7030.wav',
  'snare7030.wav',
  'tom7030.wav',
]

const DP50_FILES = [
  'DP50_BD.wav',
  'DP50_Chh.wav',
  'DP50_Clap.wav',
  'DP50_Conga1.wav',
  'DP50_Conga2.wav',
  'DP50_Crash.wav',
  'DP50_Ohh.wav',
  'DP50_Phh.wav',
  'DP50_Ride.wav',
  'DP50_Rim.wav',
  'DP50_Snare.wav',
  'DP50_Tamb.wav',
  'DP50_Tom1.wav',
  'DP50_Tom2.wav',
  'DP50_Tom3.wav',
  'DP50_Tom4.wav',
]

const DRM1_FILES = [
  'VER.- 01    .wav',
  'VER.- 02    .wav',
  'VER.- 03    .wav',
  'VER.- 04    .wav',
  'VER.- 05    .wav',
  'VER.- 06    .wav',
  'VER.- 07    .wav',
  'VER.- 08    .wav',
  'VER.- 09    .wav',
  'VER.- 10    .wav',
  'VER.- 11    .wav',
  'VER.- 12    .wav',
  'VER.- 13    .wav',
  'VER.- 14    .wav',
  'VER.- 15    .wav',
  'VER.- 16    .wav',
  'VER.- 17    .wav',
  'VER.- 18    .wav',
  'VER.- 19    .wav',
  'VER.- 20    .wav',
  'VER.- 21    .wav',
  'VER.- 22    .wav',
  'VER.- 23    .wav',
  'VER.- 24    .wav',
  'VER.- 25    .wav',
  'VER.- 26    .wav',
  'VER.- 27    .wav',
  'VER.- 28    .wav',
  'VER.- 29    .wav',
  'VER.- 30    .wav',
  'VER.- 31    .wav',
  'VER.- 32    .wav',
  'VER.- 33    .wav',
  'VER.- 34    .wav',
  'VER.- 35    .wav',
  'VER.- 36    .wav',
  'VER.- 37    .wav',
  'VER.- 38    .wav',
  'VER.- 39    .wav',
  'VER.- 40    .wav',
]

const GBASP_FILES = [
  'GBA-SP BD1.wav',
  'GBA-SP BD2.wav',
  'GBA-SP BD3.wav',
  'GBA-SP BD4.wav',
  'GBA-SP Clap.wav',
  'GBA-SP Perc1.wav',
  'GBA-SP Perc2.wav',
  'GBA-SP Perc3.wav',
  'GBA-SP SD1.wav',
  'GBA-SP SD2.wav',
]

const LINN_FILES = [
  'A-LinnBD_1.wav',
  'A-LinnBD_2.wav',
  'A-LinnBD_3.wav',
  'A-LinnBD_4.wav',
  'A-LinnBD_5.wav',
  'A-LinnBD_6.wav',
  'A-LinnBD_7.wav',
  'A-LinnBD_8.wav',
  'A-LinnBD_9.wav',
  'A-LinnHHOp.wav',
  'A-LinnHH_1.wav',
  'A-LinnHH_2.wav',
  'A-LinnHH_3.wav',
  'A-LinnHH_4.wav',
  'A-LinnHH_5.wav',
  'A-LinnHH_6.wav',
  'A-LinnPerc1.wav',
  'A-LinnPerc10.wav',
  'A-LinnPerc11.wav',
  'A-LinnPerc12.wav',
  'A-LinnPerc2.wav',
  'A-LinnPerc3.wav',
  'A-LinnPerc4.wav',
  'A-LinnPerc5.wav',
  'A-LinnPerc6.wav',
  'A-LinnPerc7.wav',
  'A-LinnPerc8.wav',
  'A-LinnPerc9.wav',
  'A-LinnRide.wav',
  'A-LinnRim.wav',
  'A-LinnSNR_1.wav',
  'A-LinnSNR_2.wav',
  'A-LinnSNR_3.wav',
  'A-LinnSNR_4.wav',
  'A-LinnSNR_5.wav',
  'A-LinnSNR_6.wav',
  'A-LinnSNR_7.wav',
  'A-LinnSNR_8.wav',
  'A-LinnTomhi.wav',
  'A-LinnTomlo.wav',
]

const MR16_FILES = [
  'MR16_Agogo_Hi_C2A.wav',
  'MR16_Agogo_Lo_C2A.wav',
  'MR16_Agogo_Lo_T1A.wav',
  'MR16_BD_01_C2A.wav',
  'MR16_BD_01_T1A.wav',
  'MR16_BD_02_C2A.wav',
  'MR16_BD_02_T1A.wav',
  'MR16_Cabasa_C2A.wav',
  'MR16_Cabasa_T1A.wav',
  'MR16_Clap_C2A.wav',
  'MR16_Clap_T1A.wav',
  'MR16_CongaHigh_C2A.wav',
  'MR16_CongaHigh_T1A.wav',
  'MR16_CongaLow_C2A.wav',
  'MR16_CongaLow_T1A.wav',
  'MR16_Cow_C2A.wav',
  'MR16_Cow_T1A.wav',
  'MR16_Cym_C2A.wav',
  'MR16_HH_C2A.wav',
  'MR16_HH_T1A.wav',
  'MR16_HHo_C2A.wav',
  'MR16_HHo_T1A.wav',
  'MR16_Ride_C2A.wav',
  'MR16_Ride_T1A.wav',
  'MR16_Rim_C2A.wav',
  'MR16_Snr_C2A.wav',
  'MR16_Timbale_C2A.wav',
  'MR16_TomHigh_C2A.wav',
  'MR16_TomLow_C2A.wav',
  'MR16_WoodBlock_C2A.wav',
]

const MSC909_FILES = [
  'BD_01.wav',
  'BD_02.wav',
  'BD_03.wav',
  'BD_04.wav',
  'BD_05.wav',
  'BD_06.wav',
  'BD_07.wav',
  'BD_08.wav',
  'BD_09.wav',
  'BD_10.wav',
  'BD_11.wav',
  'BD_12.wav',
  'BD_13.wav',
  'BD_14.wav',
  'BD_15.wav',
  'BD_16.wav',
  'BD_17.wav',
  'BD_18.wav',
  'BD_19.wav',
  'BD_20.wav',
  'BD_21.WAV',
  'BD_22.WAV',
  'BD_23.WAV',
  'Close_HH_01.wav',
  'Close_HH_02.wav',
  'Close_HH_03.wav',
  'Close_HH_04.wav',
  'Close_HH_05.wav',
  'Close_HH_06.wav',
  'Close_HH_07.wav',
  'Close_HH_08.wav',
  'Close_HH_09.wav',
  'Close_HH_10.wav',
  'Close_HH_11.wav',
  'Close_HH_12.wav',
  'Close_HH_13.wav',
  'Close_HH_14.wav',
  'Close_HH_15.wav',
  'Close_HH_16.wav',
  'Open_HH_01.wav',
  'Open_HH_02.wav',
  'Open_HH_03.wav',
  'Open_HH_04.wav',
  'Open_HH_05.wav',
  'Open_HH_06.wav',
  'Open_HH_07.wav',
  'Open_HH_08.wav',
  'Open_HH_09.wav',
  'Open_HH_10.wav',
  'Open_HH_11.wav',
  'Open_HH_12.wav',
  'Open_HH_13.wav',
  'Ride_01.wav',
  'Rim_01.wav',
  'Rim_02.wav',
  'Rim_03.WAV',
  'Rim_04.WAV',
  'Snare_01.wav',
  'snare_02.wav',
  'snare_03.wav',
  'snare_04.wav',
  'snare_05.wav',
  'snare_06.wav',
  'snare_07.wav',
  'snare_08.wav',
  'snare_09.wav',
  'snare_10.wav',
  'snare_11.wav',
  'snare_12.wav',
  'snare_13.wav',
]

const MODULAR_FILES = [
  'Clap 01 - Low.wav',
  'Clap 02 - Hi.WAV',
  'Click 01 - Short.wav',
  'Cowbell 01 - Low.wav',
  'Cowbell 02 - Hi.WAV',
  'Cymbal 01 - Dirty Noise.wav',
  'Cymbal 02 - Clean Noise.wav',
  'Cymbal 03 - 4 Osc Ride.wav',
  'Cymbal 04 - 4 Osc Ping.wav',
  'Cymbal 05 - Hi Ping.wav',
  'Hats 01 - Ticky.wav',
  'Hats 02 - Ticky Hi1.wav',
  'Hats 03 - Ticky Hi2.WAV',
  'Hats 04 - Ticky Hi3.WAV',
  'Hats 05 - Ticky Hi Pedal.wav',
  'Hats 06 - Ticky Hi Open.wav',
  'Hats 07 - Ticky Open.wav',
  'Kick 01 - Short1.wav',
  'Kick 02 - Short2.WAV',
  'Kick 03 - Middle.wav',
  'Kick 04 - Long.wav',
  'Kick 05 - Longer.wav',
  'Rimshot 01 - Rim.WAV',
  'Rimshot 02 - Rim.WAV',
  'Rimshot 03 - Rim.WAV',
  'Snare 01 - Damped Low.wav',
  'Snare 02 - Damped Hi.wav',
  'Snare 03 - Damped Pic.wav',
  'Snare 04 - Hi Simmons1.wav',
  'Snare 04 - Hi Simmons2.WAV',
  'Snare 05 - Low Simmons1.wav',
  'Snare 06 - Low Simmons2.WAV',
  'Tom 01 - Hi Tom.WAV',
  'Tom 02 - Mid Tom.wav',
  'Tom 03 - Mid-Hi Tom.wav',
  'Tom 04 - Low Tom1.WAV',
  'Tom 05 - Low Tom2.WAV',
]

const MODULAR55_FILES = [
  'Moog BD1.wav',
  'Moog BD10.wav',
  'Moog BD11.wav',
  'Moog BD12.wav',
  'Moog BD2.wav',
  'Moog BD3.wav',
  'Moog BD4.wav',
  'Moog BD5.wav',
  'Moog BD6.wav',
  'Moog BD7.wav',
  'Moog BD8.wav',
  'Moog BD9.wav',
  'Moog BL1.WAV',
  'Moog BL2.WAV',
  'Moog HH1.wav',
  'Moog HH2.wav',
  'Moog HH3.wav',
  'Moog HH4.wav',
  'Moog PC1.wav',
  'Moog PC2.wav',
  'Moog RM1.wav',
  'Moog RM2.wav',
  'Moog RM3.WAV',
  'Moog SD1.wav',
  'Moog SD2.wav',
  'Moog SD3.wav',
  'Moog SD4.wav',
  'Moog SD5.wav',
  'Moog SD6.wav',
  'Moog SD7.wav',
  'Moog SD8.wav',
  'Moog ST1.WAV',
  'Moog ST2.WAV',
  'Moog ST3.WAV',
  'Moog ST4.WAV',
]

const PS1_FILES = [
  'Synare01.wav',
  'Synare02.wav',
  'Synare03.wav',
  'Synare04.wav',
  'Synare05.wav',
  'Synare06.wav',
  'Synare07.wav',
  'Synare08.wav',
  'Synare09.wav',
  'Synare10.wav',
  'Synare11.wav',
  'Synare12.wav',
  'Synare13.wav',
  'Synare14.wav',
  'Synare15.wav',
  'Synare16.wav',
  'Synare17.wav',
  'Synare18.wav',
  'Synare19.wav',
  'Synare20.wav',
  'Synare21.wav',
  'Synare22.wav',
  'Synare23.wav',
  'Synare24.wav',
  'Synare25.wav',
  'Synare26.wav',
  'Synare27.wav',
  'Synare28.wav',
  'Synare29.wav',
  'Synare30.wav',
  'Synare31.wav',
  'Synare32.wav',
]

const R50E_FILES = [
  'BASSELEC.WAV',
  'BASSFNK1.WAV',
  'BASSFNK2.WAV',
  'BD1_ELEC.WAV',
  'BD2_REV.WAV',
  'BD3_ACOU.WAV',
  'CLAP_1.WAV',
  'CLAP_2.WAV',
  'CLICK_1.WAV',
  'CLICK_2.WAV',
  'CLICK_3.WAV',
  'CRASH.WAV',
  'ETOM_H.WAV',
  'ETOM_L.WAV',
  'ETOM_M.WAV',
  'FLANGED.WAV',
  'HAT_C1.WAV',
  'HAT_C2.WAV',
  'HAT_C3.WAV',
  'HAT_C4.WAV',
  'HAT_C5.WAV',
  'HAT_O1.WAV',
  'HAT_O2.WAV',
  'HIT_ELEC.WAV',
  'HIT_FLNG.WAV',
  'HIT_GATE.WAV',
  'HIT_ORCH.WAV',
  'REVTOM_H.WAV',
  'REVTOM_L.WAV',
  'RIM.WAV',
  'SD1_ELEC.WAV',
  'SD1_FLAM.WAV',
  'SD1_GATE.WAV',
  'SD2_FLNG.WAV',
  'SD2_GATE.WAV',
  'SD2_REV.WAV',
  'SD3_ACOU.WAV',
  'SD4_GATE.WAV',
  'SNAP.WAV',
  'TIMPANI.WAV',
]

const SPACEDRUM_FILES = [
  'BASS1.WAV',
  'BASS2.WAV',
  'BASS3.WAV',
  'BASS4.WAV',
  'BDRUM1.WAV',
  'BDRUM10.WAV',
  'BDRUM11.WAV',
  'BDRUM2.WAV',
  'BDRUM3.WAV',
  'BDRUM4.WAV',
  'BDRUM5.WAV',
  'BDRUM6.WAV',
  'BDRUM7.WAV',
  'BDRUM8.WAV',
  'BDRUM9.WAV',
  'COWBELL.WAV',
  'HHCLOSE1.WAV',
  'HHCLOSE2.WAV',
  'HHCLOSE3.WAV',
  'HHCLOSE4.WAV',
  'HHOPEN1.WAV',
  'HHOPEN2.WAV',
  'HHOPEN3.WAV',
  'HHPEDAL1.WAV',
  'REVERSED.WAV',
  'RIMSHOT.WAV',
  'SEQ1.WAV',
  'SEQ2.WAV',
  'SNARE1.WAV',
  'SNARE2.WAV',
  'SNARE3.WAV',
  'TOM1.WAV',
  'TOM2.WAV',
  'TOM3.WAV',
  'TOM4.WAV',
  'TOM5.WAV',
  'TOM6.WAV',
  'TOM7.WAV',
  'WOOD1.WAV',
  'WOOD2.WAV',
]

const VARI64_FILES = [
  'HA64 BD 1   .wav',
  'HA64 BD 2   .wav',
  'HA64 BD 3   .wav',
  'HA64 BD 4   .wav',
  'HA64 CLAV1  .wav',
  'HA64 CLAV2  .wav',
  'HA64 CYM1   .wav',
  'HA64 CYM2   .wav',
  'HA64 HH 1   .wav',
  'HA64 HH 2   .wav',
  'HA64 HH 3   .wav',
  'HA64 HH 4   .wav',
  'HA64 HH 5   .wav',
  'HA64 HH 6   .wav',
  'HA64 HHO1   .wav',
  'HA64 HHO2   .wav',
  'HA64 HHO4   .wav',
  'HA64 SD1.1  .wav',
  'HA64 SD1.3  .wav',
  'HA64 SD1.4  .wav',
  'HA64 SD2.1  .wav',
  'HA64 SD2.2  .wav',
  'HA64 SD3.1  .wav',
  'HA64 SD3.2  .wav',
  'HA64 SD4.1  .wav',
  'HA64 SD4.2  .wav',
  'HA64 SD5.1  .wav',
  'HA64 SD5.2  .wav',
  'HA64 SHA1   .wav',
  'HA64 SHA2   .wav',
  'HA64 SHA3   .wav',
  'HA64 SHA4   .wav',
  'HA64 TOM A1 .wav',
  'HA64 TOM A2 .wav',
  'HA64 TOM B1 .wav',
  'HA64 TOM B2 .wav',
]

const ZAPP_FILES = [ // ponytail: sampler mapea hasta 84 archivos — los extras no se cargan
  '00.wav',
  '01.wav',
  '02.wav',
  '03.wav',
  '04.wav',
  '05.wav',
  '06.wav',
  '07.wav',
  '08.wav',
  '09.wav',
  '10.wav',
  '100.wav',
  '101.wav',
  '102.wav',
  '103.wav',
  '104.wav',
  '11.wav',
  '12.wav',
  '13.wav',
  '14.wav',
  '15.wav',
  '16.wav',
  '17.wav',
  '18.wav',
  '19.wav',
  '20.wav',
  '21.wav',
  '22.wav',
  '23.wav',
  '24.wav',
  '25.wav',
  '26.wav',
  '27.wav',
  '28.wav',
  '29.wav',
  '30.wav',
  '31.wav',
  '32.wav',
  '33.wav',
  '34.wav',
  '35.wav',
  '36.wav',
  '37.wav',
  '38.wav',
  '39.wav',
  '40.wav',
  '41.wav',
  '42.wav',
  '43.wav',
  '44.wav',
  '45.wav',
  '46.wav',
  '47.wav',
  '48.wav',
  '49.wav',
  '50.wav',
  '51.wav',
  '52.wav',
  '53.wav',
  '54.wav',
  '55.wav',
  '56.wav',
  '57.wav',
  '58.wav',
  '59.wav',
  '60.wav',
  '61.wav',
  '62.wav',
  '63.wav',
  '64.wav',
  '65.wav',
  '66.wav',
  '67.wav',
  '68.wav',
  '69.wav',
  '70.wav',
  '71.wav',
  '72.wav',
  '73.wav',
  '75.wav',
  '76.wav',
  '77.wav',
  '78.wav',
  '79.wav',
  '80.wav',
  '81.wav',
  '82.wav',
  '83.wav',
  '84.wav',
  '85.wav',
  '86.wav',
  '87.wav',
  '88.wav',
  '89.wav',
  '90.wav',
  '91.wav',
  '92.wav',
  '93.wav',
  '94.wav',
  '95.wav',
  '96.wav',
  '97.wav',
  '98.wav',
  '99.wav',
]

const AXXE_FILES = [
  'cw_arp_axxe00.wav',
  'cw_arp_axxe01.wav',
  'cw_arp_axxe02.wav',
  'cw_arp_axxe03.wav',
  'cw_arp_axxe04.wav',
  'cw_arp_axxe05.wav',
  'cw_arp_axxe06.wav',
  'cw_arp_axxe07.wav',
  'cw_arp_axxe08.wav',
  'cw_arp_axxe09.wav',
  'cw_arp_axxe10.wav',
  'cw_arp_axxe11.wav',
  'cw_arp_axxe12.wav',
  'cw_arp_axxe13.wav',
  'cw_arp_axxe14.wav',
  'cw_arp_axxe15.wav',
  'cw_arp_axxe16.wav',
  'cw_arp_axxe17.wav',
  'cw_arp_axxe18.wav',
  'cw_arp_axxe19.wav',
  'cw_arp_axxe20.wav',
  'cw_arp_axxe21.wav',
  'cw_arp_axxe22.wav',
  'cw_arp_axxe23.wav',
  'cw_arp_axxe24.wav',
  'cw_arp_axxe25.wav',
  'cw_arp_axxe26.wav',
  'cw_arp_axxe27.wav',
  'cw_arp_axxe28.wav',
  'cw_arp_axxe30.wav',
  'cw_arp_axxe31.wav',
  'cw_arp_axxe32.wav',
  'cw_arp_axxe33.wav',
  'cw_arp_axxe34.wav',
  'cw_arp_axxe35.wav',
  'cw_arp_axxe36.wav',
  'cw_arp_axxe37.wav',
  'cw_arp_axxe38.wav',
  'cw_arp_axxe39.wav',
  'cw_arp_axxe40.wav',
  'cw_arp_axxe41.wav',
  'cw_arp_axxe42.wav',
  'cw_arp_axxe43.wav',
  'cw_arp_axxe44.wav',
  'cw_arp_axxe45.wav',
  'cw_arp_axxe46.wav',
  'cw_arp_axxe47.wav',
  'cw_arp_axxe48.wav',
]

const POLYVOXBASS_FILES = [
  'cw_polyvoks_bass01.wav',
  'cw_polyvoks_bass02.wav',
  'cw_polyvoks_bass03.wav',
  'cw_polyvoks_bass04.wav',
  'cw_polyvoks_bass05.wav',
  'cw_polyvoks_bass06.wav',
  'cw_polyvoks_bass07.wav',
  'cw_polyvoks_bass08.wav',
  'cw_polyvoks_bass09.wav',
  'cw_polyvoks_bass10.wav',
  'cw_polyvoks_bass11.wav',
  'cw_polyvoks_bass12.wav',
  'cw_polyvoks_bass13.wav',
  'cw_polyvoks_bass14.wav',
  'cw_polyvoks_bass15.wav',
  'cw_polyvoks_bass16.wav',
  'cw_polyvoks_bass17.wav',
  'cw_polyvoks_bass18.wav',
  'cw_polyvoks_bass19.wav',
  'cw_polyvoks_bass20.wav',
  'cw_polyvoks_bass21.wav',
  'cw_polyvoks_bass22.wav',
  'cw_polyvoks_bass23.wav',
  'cw_polyvoks_bass24.wav',
  'cw_polyvoks_bass25.wav',
  'cw_polyvoks_bass26.wav',
  'cw_polyvoks_bass27.wav',
  'cw_polyvoks_bass28.wav',
  'cw_polyvoks_bass29.wav',
  'cw_polyvoks_bass30.wav',
]

const PHATTHITS_FILES = [
  'Phatt Hits_a#1_127.wav',
  'Phatt Hits_a#2_127.wav',
  'Phatt Hits_a#3_127.wav',
  'Phatt Hits_a#4_127.wav',
  'Phatt Hits_a#5_127.wav',
  'Phatt Hits_a1_127.wav',
  'Phatt Hits_a2_127.wav',
  'Phatt Hits_a3_127.wav',
  'Phatt Hits_a4_127.wav',
  'Phatt Hits_a5_127.wav',
  'Phatt Hits_b1_127.wav',
  'Phatt Hits_b2_127.wav',
  'Phatt Hits_b3_127.wav',
  'Phatt Hits_b4_127.wav',
  'Phatt Hits_b5_127.wav',
  'Phatt Hits_c#1_127.wav',
  'Phatt Hits_c#2_127.wav',
  'Phatt Hits_c#3_127.wav',
  'Phatt Hits_c#4_127.wav',
  'Phatt Hits_c#5_127.wav',
  'Phatt Hits_c1_127.wav',
  'Phatt Hits_c2_127.wav',
  'Phatt Hits_c3_127.wav',
  'Phatt Hits_c4_127.wav',
  'Phatt Hits_c5_127.wav',
  'Phatt Hits_c6_127.wav',
  'Phatt Hits_d#1_127.wav',
  'Phatt Hits_d#2_127.wav',
  'Phatt Hits_d#3_127.wav',
  'Phatt Hits_d#4_127.wav',
  'Phatt Hits_d#5_127.wav',
  'Phatt Hits_d1_127.wav',
  'Phatt Hits_d2_127.wav',
  'Phatt Hits_d3_127.wav',
  'Phatt Hits_d4_127.wav',
  'Phatt Hits_d5_127.wav',
  'Phatt Hits_e1_127.wav',
  'Phatt Hits_e2_127.wav',
  'Phatt Hits_e3_127.wav',
  'Phatt Hits_e4_127.wav',
  'Phatt Hits_e5_127.wav',
  'Phatt Hits_f#1_127.wav',
  'Phatt Hits_f#2_127.wav',
  'Phatt Hits_f#3_127.wav',
  'Phatt Hits_f#4_127.wav',
  'Phatt Hits_f#5_127.wav',
  'Phatt Hits_f1_127.wav',
  'Phatt Hits_f2_127.wav',
  'Phatt Hits_f3_127.wav',
  'Phatt Hits_f4_127.wav',
  'Phatt Hits_f5_127.wav',
  'Phatt Hits_g#1_127.wav',
  'Phatt Hits_g#2_127.wav',
  'Phatt Hits_g#3_127.wav',
  'Phatt Hits_g#4_127.wav',
  'Phatt Hits_g#5_127.wav',
  'Phatt Hits_g1_127.wav',
  'Phatt Hits_g2_127.wav',
  'Phatt Hits_g3_127.wav',
  'Phatt Hits_g4_127.wav',
  'Phatt Hits_g5_127.wav',
]

const STABS_FILES = [
  'cw_stab_acid.wav',
  'cw_stab_acid_loop129.wav',
  'cw_stab_badmice.wav',
  'cw_stab_badmice_loop128.wav',
  'cw_stab_cold.wav',
  'cw_stab_cold_loop132.wav',
  'cw_stab_hardcore.wav',
  'cw_stab_hardcore_loop126.wav',
  'cw_stab_krd.wav',
  'cw_stab_krd_loop127.wav',
  'cw_stab_lofi.wav',
  'cw_stab_lofi_loop125.wav',
  'cw_stab_nile.wav',
  'cw_stab_nile_loop128.wav',
  'cw_stab_noisy.wav',
  'cw_stab_noisy_loop127.wav',
  'cw_stab_orgy.wav',
  'cw_stab_orgy_loop126.wav',
  'cw_stab_ring_piano.wav',
  'cw_stab_ring_piano_loop126.wav',
  'cw_stab_shot.wav',
  'cw_stab_shot_loop128.wav',
  'cw_stab_solid.wav',
  'cw_stab_solid_loop125.wav',
  'cw_stab_sweep.wav',
  'cw_stab_sweep_loop125.wav',
  'cw_stab_techni.wav',
  'cw_stab_techni_loop133.wav',
  'cw_stab_vint.wav',
  'cw_stab_vint_loop132.wav',
]

const HIPHOPORCHESTRA_FILES = [
  'Agressive_OrchestraFXLoop_120_Cm.wav',
  'Agressive_ViolinLoop_120_Cm.wav',
  'Attack_ViolinLoop_098_Cm.wav',
  'Brave_CelloFXLoop_104_Em.wav',
  'Brave_CelloLoop_104_Em.wav',
  'Brave_PianoLoop_104_Em.wav',
  'Brave_StringLoop_104_Em.wav',
  'Cell_ViolinLoop_084_Em.wav',
  'District_OrchestraLoop_087_Cm-Bm.wav',
  'District_StringLoop_087_Cm-Bm.wav',
  'Ethnic1_CelloLoop_083_Dm.wav',
  'Ethnic2_CelloLoop_083_Dm.wav',
  'Ethnic_PizzaLoop_083_Dm.wav',
  'Fate_CelloFXLoop_082_Am.wav',
  'Fate_OrchestraLoop_082_Am.wav',
  'Fate_PizzaLoop_082_Am.wav',
  'Kode_ChordLoop_090_Cm.wav',
  'Kode_PianoLoop_090_Cm.wav',
  'Kode_ViolinLoop_090_Cm.wav',
  'Lost_PianoLoop_082_Am.wav',
  'Lost_ViolinLoop_082_Am.wav',
  'Mel1_ViolinLoop_085_Fm.wav',
  'Mel2_ViolinLoop_085_Fm.wav',
  'Mist_LowStringLoop_097_Am.wav',
  'Mist_StringLoop_097_Am.wav',
  'Mist_VibesLoop_097_Am.wav',
  'Mpak_ViolinLoop_085_Gm.wav',
  'NuFunk_BrassLoop_096_Am.wav',
  'NuFunk_CelloFXLoop_096_Am.wav',
  'NuFunk_CelloLoop_096_Am.wav',
  'NuFunk_VibesLoop_096_Am.wav',
  'PizzaBand_ViolinLoop_091_G#m.wav',
  'Pizzicato_ViolinLoop_098_Cm.wav',
  'Play_CelloEnsLoop_087_C.wav',
  'Pressure1_OrchestraLoop_096_Bm.wav',
  'Pressure2_OrchestraLoop_096_Bm.wav',
  'Pressure_CelloLoop_096_Bm.wav',
  'Pressure_StringLoop_096_Bm.wav',
  'Quartet_ViolinLoop_095_Cm.wav',
  'Sad_ViolinLoop_085_Em.wav',
  'Skr_PianoLoop_080_Cm.wav',
  'Skr_StringLoop_080_Cm.wav',
  'Skr_TremorLoop_080_Cm.wav',
  'Soul_CelloLoop_096_Gm.wav',
  'Soul_PizzaLoop_096_Gm.wav',
  'Soul_StringLoop_096_Gm.wav',
  'South1_ViolinLoop_092_Gm.wav',
  'South2_ViolinLoop_092_Gm.wav',
  'Symph_ViolinLoop_090_Cm.wav',
  'Tremor_ViolinLoop_125_Dm.wav',
  'Vinylistix_CelloFXLoop_096_Dm.wav',
  'Vinylistix_PinaoLoop_096_Dm.wav',
  'Vinylistix_StringLoop_096_Dm.wav',
  'Wing_ViolinLoop_085_Dm.wav',
]

const SPECTRUM_FILES = [
  'anarchy_119.wav',
  'avalon_124.wav',
  'bruce_lee_098.wav',
  'cobra_094.6.wav',
  'colony_095.wav',
  'flying_shark_135.wav',
  'fx01.wav',
  'fx02.wav',
  'fx03.wav',
  'fx04.wav',
  'fx05.wav',
  'fx06.wav',
  'fx07.wav',
  'fx08.wav',
  'fx09.wav',
  'fx10.wav',
  'fx11.wav',
  'fx12.wav',
  'fx13.wav',
  'fx14.wav',
  'fx15.wav',
  'fx16.wav',
  'fx17.wav',
  'fx18.wav',
  'fx19.wav',
  'fx20.wav',
  'fx21.wav',
  'fx22.wav',
  'lisence_to_kill1_095.wav',
  'lisence_to_kill2_095.wav',
  'madmix2_104.wav',
  'nebulus_113.wav',
  'nether_earth1_094.wav',
  'nether_earth2_092.wav',
  'operation_thunderbolt_126.wav',
  'pyjamarama_137.wav',
  'rastan1_101.wav',
  'rastan2_101.wav',
  'vari_121.wav',
  'vari_135.wav',
  'vari_143_1.wav',
  'xecutor_138.wav',
  'zombie_zombie_087.wav',
]

const ODYSSEYMULTI_FILES = [
  'Odyssey Hoover C1.wav',
  'Odyssey Hoover C2.wav',
  'Odyssey Hoover C3.wav',
  'Odyssey Hoover C4.wav',
  'Odyssey Hoover F#1.wav',
  'Odyssey Hoover F#2.wav',
  'Odyssey Hoover F#3.wav',
  'Odyssey Modder C1.wav',
  'Odyssey Modder C2.wav',
  'Odyssey Modder C3.wav',
  'Odyssey Modder C4.wav',
  'Odyssey Modder F#1.wav',
  'Odyssey Modder F#2.wav',
  'Odyssey Modder F#3.wav',
  'Odyssey Robots C1.wav',
  'Odyssey Robots C2.wav',
  'Odyssey Robots C3.wav',
  'Odyssey Robots C4.wav',
  'Odyssey Robots F#1.wav',
  'Odyssey Robots F#2.wav',
  'Odyssey Robots F#3.wav',
  'Odyssey SantaKiss C1.wav',
  'Odyssey SantaKiss C2.wav',
  'Odyssey SantaKiss C3.wav',
  'Odyssey SantaKiss C4.wav',
  'Odyssey SantaKiss C5.wav',
  'Odyssey SantaKiss C6.wav',
  'Odyssey SantaKiss C7.wav',
  'Odyssey Simple Reese C1.wav',
  'Odyssey Simple Reese C2.wav',
  'Odyssey Simple Reese C3.wav',
  'Odyssey Simple Reese F#1.wav',
  'Odyssey Simple Reese F#2.wav',
  'Odyssey Sub LR C1.wav',
  'Odyssey Sub LR C2.wav',
  'Odyssey Sub LR C3.wav',
  'Odyssey Sub LR F#1.wav',
  'Odyssey Sub LR F#2.wav',
  'Odyssey Vibrant Bass C1.wav',
  'Odyssey Vibrant Bass C2.wav',
  'Odyssey Vibrant Bass C3.wav',
  'Odyssey Vibrant Bass F#1.wav',
  'Odyssey Vibrant Bass F#2.wav',
  'Odyssey Wide PWM Pad C1.wav',
  'Odyssey Wide PWM Pad C2.wav',
  'Odyssey Wide PWM Pad C3.wav',
  'Odyssey Wide PWM Pad C4.wav',
  'Odyssey Wide PWM Pad C5.wav',
  'Odyssey Wide PWM Pad F#1.wav',
  'Odyssey Wide PWM Pad F#2.wav',
  'Odyssey Wide PWM Pad F#3.wav',
  'Odyssey Wide PWM Pad F#4.wav',
]

/**
 * Construye un preset tipo Sampler a partir de un folder. Mapea los
 * archivos en `files` a MIDI notes consecutivas desde C2 (MIDI 36). El
 * usuario toca diferentes notas para escuchar diferentes samples.
 */
function samplerPreset(folder, files, label, description) {
  const urls = {}
  for (let i = 0; i < files.length && i < 84; i++) {
    const note = midiToNoteName(36 + i)
    urls[note] = files[i]
  }
  return {
    label,
    description,
    create: () =>
      new Tone.Sampler({
        urls,
        // import.meta.env.BASE_URL vale '/' en dev y '/akai25/' en
        // producción (configurado en vite.config.js). Los samples
        // viven en public/samples/<folder>/.
        baseUrl: `${import.meta.env.BASE_URL}samples/${folder}/`,
        release: 1,
      }),
  }
}

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

  // ---------------------------------------------------------------------
  // Instrumentos basados en samples reales (Tone.Sampler). Los samples
  // viven en public/samples/<folder>/. Cada nota MIDI toca un sample
  // distinto; el mapeo es secuencial desde C2 en orden alfabético.
  // Toca C2..Bn para escuchar los samples en orden.
  // ---------------------------------------------------------------------
  ace: samplerPreset(
    'Ace',
    ACE_FILES,
    'Ace',
    `Kit de percusión Ace (${ACE_FILES.length} samples) — kicks, snares, hats, perc, clave`,
  ),
  mpc2000: samplerPreset(
    'MPC2000',
    MPC2000_FILES,
    'MPC2000',
    `Kit MPC2000 (${MPC2000_FILES.length} samples) — 808, 909, NR, Funky, etc.`,
  ),
  nes: samplerPreset(
    'NES',
    NES_FILES,
    'NES',
    `Samples estilo 8-bit NES (${NES_FILES.length} samples) — bleeps, leads, percussion retro`,
  ),
  ptx8: samplerPreset(
    'PTX8',
    PTX8_FILES,
    'PTX8',
    `Kit de percusión PTX8 (${PTX8_FILES.length} samples) — bongos, congas, timbales, hats`,
  ),
  sds2000: samplerPreset(
    'SDS2000',
    SDS2000_FILES,
    'SDS2000',
    `Kit SDS2000 — 8 factories (${SDS2000_FILES.length} samples) — BD, HT, LT, MT, SN por factory`,
  ),
  simmons: samplerPreset(
    'Simmons_ClapTrap',
    SIMMONS_FILES,
    'Simmons Clap Trap',
    `Kit Simmons Clap Trap (${SIMMONS_FILES.length} samples) — claps, snares, perc 80s`,
  ),
  specdrum: samplerPreset(
    'SpecDrum',
    SPECDRUM_FILES,
    'SpecDrum',
    `Kit SpecDrum (${SPECDRUM_FILES.length} samples) — afro, electro, latin, original`,
  ),
  asrx: samplerPreset(
    'ASR-X',
    ASR_X_FILES,
    'ASR-X',
    `Kit ASR-X (${ASR_X_FILES.length} samples) — kicks, hats, snares, ride (workstation 80s)`,
  ),
  cr7030: samplerPreset(
    'CR 7030',
    CR7030_FILES,
    'CR 7030',
    `Kit CompuRhythm CR 7030 (${CR7030_FILES.length} samples) — kick, snare, hats, perc 80s`,
  ),
  dp50: samplerPreset(
    'DP50',
    DP50_FILES,
    'DP50',
    `Kit DP50 (${DP50_FILES.length} samples) — BD, SD, hats, congas, toms estilo 808`,
  ),
  drm1: samplerPreset(
    'DRM1',
    DRM1_FILES,
    'DRM1',
    `Kit DRM1 VER series (${DRM1_FILES.length} samples) — percusión latina`,
  ),
  gbasp: samplerPreset(
    'Game-Boy-Advance-SP',
    GBASP_FILES,
    'GBA-SP',
    `Kit Game Boy Advance SP (${GBASP_FILES.length} samples) — kicks, snares, clap, perc chiptune`,
  ),
  linn: samplerPreset(
    'Linn_AdrenaLinn1',
    LINN_FILES,
    'Linn AdrenaLinn1',
    `Kit Linn AdrenaLinn1 (${LINN_FILES.length} samples) — BD, SD, hats, perc, toms`,
  ),
  mr16: samplerPreset(
    'MR-16',
    MR16_FILES,
    'MR-16',
    `Kit MR-16 (${MR16_FILES.length} samples) — BD, SD, hats, congas, toms 80s`,
  ),
  msc909: samplerPreset(
    'MSC_DL-909',
    MSC909_FILES,
    'MSC DL-909',
    `Kit MSC DL-909 (${MSC909_FILES.length} samples) — clones TR-909 (BD, SD, hats, rims)`,
  ),
  modular: samplerPreset(
    'Modular',
    MODULAR_FILES,
    'Modular',
    `Kit Modular (${MODULAR_FILES.length} samples) — kicks, snares, hats, cymbals modular`,
  ),
  modular55: samplerPreset(
    'Modular55',
    MODULAR55_FILES,
    'Modular55',
    `Kit Modular55 / Moog (${MODULAR55_FILES.length} samples) — bombo, congas, hats, perc Moog`,
  ),
  ps1: samplerPreset(
    'PS-1',
    PS1_FILES,
    'PS-1',
    `Kit PS-1 Synare (${PS1_FILES.length} samples) — caja/snare 80s`,
  ),
  r50e: samplerPreset(
    'R-50e',
    R50E_FILES,
    'R-50e',
    `Kit Roland R-50e (${R50E_FILES.length} samples) — BD, SD, hats, toms, perc`,
  ),
  spacedrum: samplerPreset(
    'Space_Drum',
    SPACEDRUM_FILES,
    'Space Drum',
    `Kit Space Drum (${SPACEDRUM_FILES.length} samples) — BD, SD, hats, toms, perc sci-fi`,
  ),
  vari64: samplerPreset(
    'Vari64',
    VARI64_FILES,
    'Vari64',
    `Kit Vari64/HA64 (${VARI64_FILES.length} samples) — percusión 60s`,
  ),
  zapp: samplerPreset(
    'Zapp',
    ZAPP_FILES,
    'Zapp',
    `Kit Syncussion Zapp (${ZAPP_FILES.length} samples) — percusión Linn 80s`,
  ),
  axxe: samplerPreset(
    'Axxe',
    AXXE_FILES,
    'ARP Axxe',
    `ARP Axxe analog synth (${AXXE_FILES.length} samples) — arpeggios/tonal one-shots`,
  ),
  polyvoxbass: samplerPreset(
    'PolyvoxBass',
    POLYVOXBASS_FILES,
    'Polyvox Bass',
    `Polyvox bass (${POLYVOXBASS_FILES.length} samples) — bajos analógicos soviéticos`,
  ),
  phatthits: samplerPreset(
    'PhattHits',
    PHATTHITS_FILES,
    'Phatt Hits',
    `E-mu MP7 multisampled (${PHATTHITS_FILES.length} samples) — hits con nota+velocity (Kontakt source)`,
  ),
  stabs: samplerPreset(
    'Stabs',
    STABS_FILES,
    'Stabs',
    `Synth stabs + loops (${STABS_FILES.length} samples) — chord hits rítmicos`,
  ),
  hiphoporch: samplerPreset(
    'HipHopOrchestra',
    HIPHOPORCHESTRA_FILES,
    'HipHop Orchestra',
    `Loops orquestales (${HIPHOPORCHESTRA_FILES.length} samples) — cello, viola, piano, strings (BPM+key en nombre)`,
  ),
  spectrum: samplerPreset(
    'Spectrum',
    SPECTRUM_FILES,
    'Spectrum',
    `ZX Spectrum chiptune (${SPECTRUM_FILES.length} samples) — loops + FX retro 80s`,
  ),
  odysseymulti: samplerPreset(
    'OdysseyMulti',
    ODYSSEYMULTI_FILES,
    'Odyssey Multi',
    `Korg ARP Odyssey multisampled (${ODYSSEYMULTI_FILES.length} samples) — notas por voz (Hoover, Sub LR, PWM Pad...)`,
  ),
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
