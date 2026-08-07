// ponytail: créditos discretos en el footer. <details>/<summary> es HTML
// nativo — click para expandir, sin estado React, accesible por teclado.
// El contenido se mantiene en este archivo (no en un .json) porque sólo
// se usa aquí y la lista cambia cuando se agregan/quitan kits.

// Fuentes con licencia documentada o verificable en disco. Lo único que
// requiere acción del usuario por licencia es KB6 (CC BY-NC-ND) — el
// resto son royalty-free declarados por el autor.
//
// DP50 figura bajo KB6 con marca "(inferencia)": no viene con su archivo
// de licencia, pero comparte patrón de naming (`<hardware>_<instr>.wav`),
// timestamp (2011-02-18) y carpeta hermana con KB6 ya acreditado.
// Inferencia alta por emparejamiento de carpetas hermanas; NO verificada
// vía web (intento agotado en julio 2026 — WebSearch/WebFetch denegados
// en este entorno).
const CREDITS = [
  {
    title: 'KB6 Samples Archive',
    license: 'CC BY-NC-ND 4.0 · © 1996 Kai',
    note: 'Sólo uso no comercial, sin derivados. Crédito obligatorio. DP50 por inferencia (ver metodología abajo).',
    kits: ['CR 7030', 'NES', 'MR-16', 'DP50 (inferido)'],
  },
  {
    title: 'Rhythm Lab',
    license: 'Royalty-free · Dmitriy "Cyberworm" Vasilyev',
    note: 'Crédito por cortesía del autor. Kits con prefijo `cw_` confirmados por nombre; los demás comparten patrón de naming (BPM/tono embebido) con los ya acreditados.',
    kits: [
      // Confirmados por prefijo `cw_` en cada .wav
      'ARP Axxe',
      'FluteLoops',
      'GameboyShots',
      'GlitchClicks',
      'MfbFx',
      'ScratchFx',
      // Sin prefijo `cw_` pero mismo patrón de naming que los ya acreditados
      'Polyvox Bass',
      'Phatt Hits',
      'Stabs',
      'HipHop Orchestra',
      'Spectrum',
      'Odyssey Multi',
      'HipHop Kicking Breaks',
      'Downtempo Loops',
      'HipHop Electronic',
      'Vintage Pad',
      'Pan Electronica',
    ],
  },
  {
    title: 'Syncussion Zapp',
    license: 'stereoping.com (auto-construido)',
    note: null,
    kits: ['Zapp'],
  },
]

// Kits atribuidos por nombre de vendor presente en el nombre de carpeta
// o de archivo — no traen LICENSE.txt en disco, así que la atribución es
// de tipo "razonable, no verificada". Si en el futuro se localiza la
// fuente original, mover al grupo correspondiente en CREDITS.
const VENDOR_NAMED_KITS = [
  // Vendor "MidiError" — reconocible por el prefijo `FM_*` y el nombre
  // del directorio. Familia de free packs bien conocida en PC/Mac.
  { vendor: 'MidiError', kits: ['MidiErrorBass', 'MidiErrorDrumLoops', 'MidiErrorDrums', 'MidiErrorFM', 'MidiErrorFx1', 'MidiErrorFx2', 'MidiErrorLeadX', 'MidiErrorLeadY', 'MidiErrorLeadZ', 'MidiErrorModLoops', 'MidiErrorSynthLoops'] },
  // Vendor "FAC" — prefijo "FAC Analog Bass Drum" / "FAC-MAG" en filenames.
  // FAC publica sample packs free con la firma `FAC-` o `FAC `.
  { vendor: 'FAC', kits: ['FacKicks', 'FacMagneticDrums'] },
  // Vendor "Bluezone Corporation" — el filename comienza con "Bluezone-".
  // Bluezone vende libraries comerciales; estos archivos son claramente
  // un sample gratis (`-Free-` en el nombre) pero no traen LICENSE.txt.
  { vendor: 'Bluezone Corporation', kits: ['Bluezone'] },
  // Vendor "Studio Wormbone" — reconocible dentro del filename
  // ("Studio Wormbone Abstract Voice Hits"). Vendor histórico de
  // sound design / sample libraries.
  { vendor: 'Studio Wormbone', kits: ['AbstractVoice'] },
]

// Kits sin info de licencia adjunta Y sin patrón claro para atribuir a
// un vendor conocido — los listamos aparte para que quede claro qué
// está "sin acreditar" en vez de inventar. Si en el futuro se localiza
// la fuente, mover al grupo correspondiente en CREDITS.
const UNKNOWN_LICENSE_KITS = [
  'Ace',
  'ASR-X',
  'ClapTrap',
  'DRM1',
  'Game-Boy-Advance-SP',
  'HipHop Exp2',
  'Linn AdrenaLinn1',
  'MPC2000',
  'MSC DL-909',
  'Modular',
  'Modular55',
  'PS-1',
  'PTX8',
  'R-50e',
  'SDS2000',
  'Simmons Clap Trap',
  'Space Drum',
  'SpecDrum',
  'Flipper Bass',
  'Vari64',
]

export function SampleCredits() {
  return (
    <details className="sample-credits">
      <summary>Sample credits &amp; licenses</summary>
      <div className="sample-credits__body">
        {CREDITS.map((c) => (
          <p key={c.title} className="sample-credits__entry">
            <strong>{c.title}</strong> — <em>{c.license}</em>.
            {c.note && <span className="sample-credits__note"> {c.note}</span>}
            <br />
            <span className="sample-credits__kits">{c.kits.join(' · ')}</span>
          </p>
        ))}
        {VENDOR_NAMED_KITS.map((v) => (
          <p key={v.vendor} className="sample-credits__entry">
            <strong>{v.vendor}</strong> — <em>royalty-free (probable, sin LICENSE.txt en disco)</em>.
            <span className="sample-credits__note"> Atribución por nombre de vendor presente en carpeta/filename. Verificar licencia antes de redistribuir.</span>
            <br />
            <span className="sample-credits__kits">{v.kits.join(' · ')}</span>
          </p>
        ))}
        <p className="sample-credits__entry sample-credits__entry--muted">
          <strong>Sin licencia documentada</strong> — asumimos todos los
          derechos reservados por sus autores respectivos. No hay archivo
          LICENSE en sus carpetas ni se pudo localizar fuente externa.
          <br />
          <span className="sample-credits__kits">
            {UNKNOWN_LICENSE_KITS.join(' · ')}
          </span>
        </p>
        <p className="sample-credits__methodology">
          Metodología: se intentó documentar vía WebSearch/WebFetch (julio
          2026). Acceso denegado en este entorno. Atribuciones finales se
          basan en (a) archivos LICENSE presentes en disco, (b)
          declaraciones de los info.txt originales, (c) inferencia de
          patrón entre carpetas hermanas cuando el caso es claro
          (DP50 ↔ KB6), (d) nombre de vendor embebido en el filename
          /carpeta (MidiError, FAC, Bluezone, Studio Wormbone).
        </p>
      </div>
    </details>
  )
}
