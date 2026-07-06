# Plan — Modo "Creative" multipista al estilo MPC Beats

## Contexto

La app (`src/App.jsx`) es un DAW lineal con un único sintetizador a la vez. Inspirándose en MPC Beats, el usuario quiere un **modo "creative"** donde convivan varias pistas con instrumentos distintos y las notas que toques queden grabadas dentro de un loop temporal cerrado. La idea: eliges instrumento de la pista activa, tocas notas, suenan en vivo y se capturan en esa pista; el playhead recorre el bucle y reproduce lo capturado junto con el resto de pistas.

**Acceso:** haciendo click en la zona derecha donde aparece el dispositivo conectado. **Salida:** botón "Volver" en la esquina.

## Decisiones confirmadas

| Pregunta | Decisión |
|---|---|
| Nº de pistas | **8** |
| Duración del loop | **2 compases** (8 negras a 100 BPM ≈ 4.8 s) |
| Comportamiento al final del loop | **Toggle por pista** "overwrite on/off" (default: **off** = persistente) |
| Salida del modo | **Botón "Volver" en la esquina** |

## Arquitectura

### Flujo general

```
[ Vista normal ]  ──click en "Dispositivo" (cabecera dcha)──▶  [ Modo creative ]
       ▲                                                          │
       └──────────────── click en "Volver" (esquina) ◀──────────────┘
```

Estado nuevo en `App.jsx`:
```js
const [mode, setMode] = useState('normal');  // 'normal' | 'creative'
```

### Punto de entrada

Mover el nombre del dispositivo del `.status` panel a un **botón clickable en la esquina superior derecha del `<header>`**. El header pasa de estar centrado a `display: flex; justify-content: space-between` con el título a la izquierda y el chip del dispositivo a la derecha.

### Capa de audio: multi-track

Refactor en `src/audio/synth.js` (mínimo, sin romper la API existente):

```
sintetizador por pista → gain de pista → masterFilter → masterReverb → destination
```

API nueva (añadir, no reemplazar):
- `createTrack(id)` → instancia synth + ganancia, conecta al bus maestro
- `removeTrack(id)` → dispose
- `setTrackInstrument(id, instrumentId)` → mismo `setInstrumentInternal` de hoy pero sobre una pista
- `setTrackMuted(id, bool)` / `setTrackVolume(id, 0..1)`
- `triggerTrackNote(id, midi, velocity, time)` / `releaseTrackNote(id, midi)`

La función `setInstrument` global actual se mantiene como **atajo para "pista 0"** (compatibilidad con `useInstrument.js` durante la transición).

### Hook `hooks/useCreativeMode.js`

Encapsula todo el estado y la sincronía del modo creative:

```js
const {
  tracks,          // Array<{ id, instrumentId, events, overwrite, muted, color }>
  activeTrackId,
  isPlaying,
  playheadTime,    // 0..loopLength en segundos
  loopLength,      // 2 compases (segundos, derivado de BPM)
  setActiveTrack,
  setTrackInstrument,
  toggleOverwrite,
  toggleMute,
  clearTrack,
  clearAll,
  start,
  stop,
  recordEvent,     // ({ note, velocity, duration }) → graba en activeTrack
} = useCreativeMode({ bpm });
```

**Modelo de eventos y overwrite:**
- Cada track guarda `events: [{ note, velocity, localTime, duration }]` con `localTime ∈ [0, loopLength)`.
- Live: `recordEvent` añade el evento al array de la pista activa con `localTime = playheadTime`.
- Reproducción: cada track tiene su propio `Tone.Part` que reproduce sus eventos en bucle.
- **Overwrite por pista:**
  - `overwrite = false` (default): los eventos **se conservan entre vueltas del playhead**. El usuario puede ir construyendo el patrón loop a loop: lo grabado en la vuelta 1 sigue sonando en la vuelta 2 (mientras no se borre manualmente con el `✕` del track o con Clear all). Estilo DAW tradicional.
  - `overwrite = true`: cada vez que el playhead cruza el final del loop, el track **vacía sus eventos previos** antes de aceptar nuevos. Estilo MPC — útil si quieres regrabar una capa de cero en cada loop, pero pierdes lo anterior.
- **Por qué cambió el default:** la primera versión tenía overwrite=true por defecto, pero al probarlo el usuario se sorprendió de que todo lo grabado se borrara en cuanto el playhead daba una vuelta. El nuevo default (off) hace que el modo se sienta como un "pattern" que vas llenando; el toggle es opt-in para el comportamiento MPC agresivo.
- Live listening: las notas que tocas **siempre** suenan a través del synth de la pista activa.
- Sin playhead corriendo → no se captura nada; solo se escucha el `Tone.Part` reproduciendo lo capturado.

### Componente `components/CreativeMode.jsx`

```
┌─────────────────────────────────────────────────────────────┐
│  [Volver]              LOOP 1·2·3·4·5·6·7·8      [Play/Stop] │
│                                                [Clear all]   │
├─────────────────────────────────────────────────────────────┤
│  ▮ playhead (línea vertical púrpura, se mueve con Tone.Draw)│
├─────────────────────────────────────────────────────────────┤
│  [T1 ▾Piano]  ░░██░░░░██░░░░░░░░░░  [ow][mute]              │
│  [T2 ▾Bass]   ░░░░░░░░░░░░░░░░██░░  [ow][mute]              │
│  ...  (×8)                                                   │
├─────────────────────────────────────────────────────────────┤
│  [Teclado] (reutilizado tal cual)                            │
└─────────────────────────────────────────────────────────────┘
```

Sub-componentes:
- `CreativeTrack.jsx` — fila de pista: selector de instrumento, toggle overwrite, toggle mute, eventos visualizados como rectángulos sobre la línea de tiempo.
- Regla de tiempos superior: marcas cada negra ("1", "1.2", "1.3", "1.4", "2.1", ...).
- Playhead: `<div>` posicionado absolutamente, `left = (playheadTime / loopLength) * 100%`. Refresco vía `Tone.Draw.schedule`.

### Integración MIDI/teclado en creative

En `App.jsx`, los handlers `onNoteOn` / `onNoteOff` redirigen, en modo creative, a:

```js
onNoteOn: (note, velocity) => {
  synth.triggerTrackNote(activeTrackId, note, velocity, Tone.now());
  if (isPlaying) creative.recordEvent({ note, velocity });
}
```

El teclado en pantalla también dispara estos handlers.

## Ficheros

### Nuevos

| Path | Propósito |
|---|---|
| `src/hooks/useCreativeMode.js` | Estado + scheduling de las 8 pistas, playhead, overwrite, mute |
| `src/components/CreativeMode.jsx` | Vista completa del modo creative |
| `src/components/CreativeTrack.jsx` | Fila individual de pista |
| `src/components/CreativeHeader.jsx` | Cabecera interna con "Volver", regla de tiempos, transport |

### Modificados

| Path | Cambio |
|---|---|
| `src/App.jsx` | Estado `mode`; cabecera con chip clickable; render condicional `<CreativeMode>`; redirigir `onNoteOn/Off` cuando `mode === 'creative'` |
| `src/audio/synth.js` | Refactor mínimo a multi-track |
| `src/App.css` | Estilos `.creative-*`, `.device-chip`, `.back-button` |

### Sin tocar

`useRecorder.js`, `useMidi.js`, `Keyboard.jsx`, `PitchBendSlider.jsx`, `SustainToggle.jsx`, `MetronomeControl.jsx`, `Transport.jsx`, `PersistenceControls.jsx`, `useInstrument.js`. El modo creative tiene su propio modelo de captura; `useRecorder` queda intacto para la vista normal.

## Verificación

1. `npm run build` sin errores.
2. `npm run lint` sin nuevos warnings.
3. Smoke manual:
   - Conectar MIDI (o usar teclado en pantalla).
   - Verificar que el nombre del dispositivo aparece como chip clickable arriba a la derecha.
   - Click en el chip → entra modo creative; desaparece la vista normal.
   - Verificar 8 pistas visibles con selector de instrumento cada una.
   - Pulsar **Play**. Verificar que el playhead aparece y se mueve.
   - Tocar notas en el teclado → suenan en vivo y aparecen como rectángulos en la pista activa.
   - Cambiar de pista activa (click en otra fila) → las siguientes notas van a la otra pista.
   - Cambiar instrumento de una pista → las notas siguientes usan ese instrumento.
   - Esperar a que el playhead dé una vuelta completa → se oyen las notas grabadas en loop.
   - Toggle overwrite en una pista → con OFF (default), los eventos grabados se mantienen tras cada vuelta del playhead (puedes ir sumando loop a loop); con ON, la siguiente vuelta reemplaza lo anterior (estilo MPC).
   - Toggle mute → la pista deja de sonar; sus rectángulos siguen visibles.
   - Botón **Export** → renderiza el loop entero a WAV con Tone.Offline (un AudioContext efímero que renderiza en background, ignorando el bus live) y descarga el archivo. Los efectos master (filter, reverb) NO se incluyen en el export — se renderiza en seco. El botón aparece deshabilitado mientras no haya eventos grabados.
   - Botón **Volver** → vuelve a la vista normal.

## Fuera de alcance (explícito)

- Persistencia del estado creative entre sesiones.
- Volumen por pista (solo mute en v1).
- Solo por pista.
- Borrar notas individuales arrastrando; solo `clearTrack` y `clearAll`.
- Metronome audible dentro de creative.
- Vista tipo piano-roll.
- **Loop length variable** (deseado por el usuario: "que la línea se pudiera ampliar por el tiempo de reproducción"). Por ahora fijo en 2 compases.
- **Selección de región en el timeline** (deseado por el usuario: "seleccionar una parte de ese tiempo de reproducción"). Por ahora solo se opera sobre el loop completo (incluido el export).
- Incluir efectos master (filter/reverb) en el export offline — el render sale en seco.
- Reordenar pistas, importar/exportar patrones MPC.
- Tests automatizados.

## Notas de implementación (ponytail)

- Refactor de `synth.js` mínimo: añadir funciones de pista y dejar `setInstrument` global como wrapper de la pista 0.
- No introducir nuevas librerías (Tone.js basta). Con `Tone.Part` por pista + `Tone.Draw` para el playhead ya tenemos lo necesario.
- No abstracciones innecesarias: las pistas son objetos literales en `useState`; si crece, ya se refactoriza.