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
    note: 'Crédito por cortesía del autor.',
    kits: [
      'ARP Axxe',
      'Polyvox Bass',
      'Phatt Hits',
      'Stabs',
      'HipHop Orchestra',
      'Spectrum',
      'Odyssey Multi',
    ],
  },
  {
    title: 'Syncussion Zapp',
    license: 'stereoping.com (auto-construido)',
    note: null,
    kits: ['Zapp'],
  },
]

// Kits sin info de licencia adjunta Y sin patrón claro para atribuir a
// KB6 — los listamos aparte para que quede claro qué está "sin acreditar"
// en vez de inventar. Si en el futuro se localiza la fuente, mover al
// grupo correspondiente en CREDITS.
const UNKNOWN_LICENSE_KITS = [
  'Ace',
  'ASR-X',
  'ClapTrap',
  'DRM1',
  'Game-Boy-Advance-SP',
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
          (DP50 ↔ KB6).
        </p>
      </div>
    </details>
  )
}