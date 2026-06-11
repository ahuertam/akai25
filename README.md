# AKAI25 Web DAW

Estación de trabajo musical web (Web DAW) ligera que actúa como puente directo entre el teclado **Akai LPK25** y el navegador. Permite tocar sintetizadores virtuales en tiempo real con latencia mínima gracias a la Web MIDI API, grabar ideas musicales, escucharlas y experimentar con diferentes sonidos — todo corriendo nativamente en una pestaña de Chrome o Edge sin instalar drivers ni software adicional.

![Status](https://img.shields.io/badge/status-MVP-success)
![Stack](https://img.shields.io/badge/stack-Vite%20%2B%20React%20%2B%20Tone.js-blueviolet)
![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-blue)

## Características

- 🎹 **Conexión MIDI directa** con el Akai LPK25 vía Web MIDI API (sin drivers, sin software extra)
- 🎨 **Teclado virtual con feedback visual** — 3 octavas (C2–C5) que se iluminan al ritmo de la ejecución
- 🎚️ **5 sintetizadores** de Tone.js intercambiables en caliente:
  - **Synth** — PolySynth triangular genérico
  - **Piano** — PolySynth con envolvente de piano
  - **Bass** — MonoSynth monofónico con filtro (ideal para bajos)
  - **Pluck** — Cuerda pulsada Karplus-Strong
  - **FM Bell** — Síntesis FM con modulación sinusoidal
- ⏺️ **Grabación y reproducción** con timing preciso (Tone.Transport)
- 🥁 **Metrónomo** con BPM configurable (40–240) y sincronía audio/visual
- 💾 **Persistencia automática** de grabaciones, instrumento y dispositivo en `localStorage`
- ⬇️ **Descarga de grabaciones** como archivo `.json` con metadatos (versión, fecha, nº de eventos)
- 🔌 **Selector de dispositivo MIDI** cuando hay varios controladores conectados
- 📱 **Diseño responsive** que se ve bien en móvil (aunque el MIDI solo funcione en PC)

## Requisitos

- **Navegador**: Chrome o Edge (los únicos con soporte estable de Web MIDI API)
- **Hardware**: Akai LPK25 u otro controlador MIDI USB
- **Sistema**: macOS, Windows o Linux con un puerto USB disponible

## Inicio rápido

```bash
# Instalar dependencias
npm install

# Arrancar el servidor de desarrollo (http://localhost:5173)
npm run dev
```

Abre `http://localhost:5173/`, conecta el Akai por USB, pulsa **Conectar** y acepta el permiso MIDI cuando el navegador lo solicite.

## Scripts disponibles

| Comando           | Descripción                                          |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | Servidor de desarrollo con HMR                       |
| `npm run build`   | Build de producción (genera `dist/`)                 |
| `npm run preview` | Sirve el build de producción localmente              |
| `npm run lint`    | Ejecuta ESLint sobre el código                       |

## Uso

### Flujo básico
1. Pulsa **🎹 Conectar** → el navegador pide permiso MIDI, acéptalo
2. Toca una tecla del Akai → oirás el sonido y la tecla virtual se iluminará
3. Cambia de instrumento desde el selector → el sonido cambia en tiempo real
4. Toca más notas para experimentar con cada sonido

### Grabación
1. Pulsa **🔴 Grabar** → el botón se vuelve rojo y aparece el badge `● REC`
2. Toca una melodía en el Akai (puedes activar el metrónomo antes para tocar con tempo)
3. Pulsa **⏹ Parar** → la grabación queda guardada (también en `localStorage`)
4. Pulsa **▶ Reproducir** → oirás tu secuencia con el instrumento actual
5. **⬇ Descargar** exporta la grabación como `.json`; **🗑 Limpiar** la borra

### Multi-dispositivo
Si conectas varios controladores MIDI, aparece un selector debajo del panel de estado. Elige cuál quieres escuchar — los mensajes de los demás se ignoran.

## Estructura del proyecto

```
src/
├── audio/                  Módulos de audio (Tone.js, sin React)
│   ├── synth.js            Sintetizador polifónico/mono con cambio de instrumento
│   └── metronome.js        Click del metrónomo basado en Transport.scheduleRepeat
│
├── hooks/                  Hooks de React con lógica de dominio
│   ├── useMidi.js          Web MIDI API + filtrado por dispositivo
│   ├── useRecorder.js      Grabación + reproducción + persistencia
│   ├── useInstrument.js    Estado del instrumento activo + localStorage
│   └── useMetronome.js     Estado del metrónomo + pulso visual
│
├── components/             Componentes presentacionales
│   ├── Keyboard.jsx        Teclado virtual (teclas blancas + negras)
│   ├── Transport.jsx       Botones Rec / Stop / Play
│   ├── InstrumentSelector.jsx
│   ├── MetronomeControl.jsx
│   ├── DeviceSelector.jsx
│   └── PersistenceControls.jsx
│
├── utils/                  Utilidades puras (sin React, fáciles de testear)
│   └── notes.js            Conversiones MIDI ↔ nombre, layout del teclado
│
├── App.jsx                 Composición de los hooks y componentes
├── App.css                 Estilos de la app
├── index.css               Reset y variables CSS base
└── main.jsx                Entry point
```

## Decisiones técnicas

### Por qué `Tone.now()` y no `performance.now()` para los tiempos de grabación
`Tone.now()` está sincronizado con el `AudioContext`, así que las conversiones a "transport time" son directas. `performance.now()` usa un epoch diferente y requeriría offsets complicados.

### Por qué `Tone.Draw.schedule` para el visual del playback
Se sincroniza con `requestAnimationFrame`, así que las teclas se encienden en el frame más cercano al `time` del AudioContext, compensando la latencia del buffer de audio. Si se usara `setTimeout`, habría un desfase perceptible entre el sonido y la luz.

### Por qué `useRef` para `isRecording` e `isPlaying` en `useRecorder`
Los handlers MIDI se registran una sola vez en `onmidimessage`. Si leyeran el `state` directamente, tendrían closures obsoletas (el `useState` crea una nueva función en cada render). Los refs se actualizan fuera del flujo de render y siempre reflejan el último valor.

### Bass usa `releaseAll()` en lugar de `triggerRelease(freq)`
`Tone.MonoSynth.triggerRelease` compara la frecuencia que le pasas con la almacenada internamente en un `Tone.Signal`, y la comparación puede fallar por precisión de coma flotante. Como es monofónico, `releaseAll()` es seguro y libera la nota actual de forma confiable.

### `useMemo` en lugar de `useEffect + setState` en `useMidi`
El lint rule de React 19 (`react-hooks/set-state-in-effect`) detecta la cascada de renders que produce un effect que llama `setState` síncronamente. Derivar el valor en render es más rápido y limpio.

### 5 instrumentos detrás de un `getSynth()` singleton
El `synth` se almacena en un `let` interno accesible vía getter. Esto permite que `useMidi` (tocar en vivo) y `useRecorder` (reproducir) operen siempre sobre el instrumento actual, sin re-suscribirse cuando el usuario cambia de sonido. El `setInstrument()` se encarga de hacer `dispose()` del anterior y crear el nuevo en caliente.

## Limitaciones conocidas

- **MIDI solo en Chrome/Edge** — Safari y Firefox no soportan Web MIDI API estable
- **Bass y Pluck son monofónicos** — solo puede sonar una nota a la vez (es la naturaleza del instrumento)
- **El visual del teclado cubre C2–C5** — notas fuera de ese rango se muestran en el display grande pero no iluminan ninguna tecla
- **No hay exportación a Standard MIDI File** — solo JSON propio del proyecto (válido para importar de vuelta, no compatible con DAWs externos)
- **`localStorage` tiene límite de ~5 MB** — grabaciones muy largas (>50k notas) podrían no persistir
- **Sin piano roll ni edición** — la grabación es lineal; no se pueden mover notas individuales después de grabar

## Roadmap

El proyecto se ha construido siguiendo 4 hitos documentados en [`roadmap.md`](./roadmap.md):

- ✅ **Hito 1** — Fundación (conexión MIDI + sonido básico)
- ✅ **Hito 2** — Interfaz visual y feedback
- ✅ **Hito 3** — Grabación y secuenciador
- ✅ **Hito 4** — Pulido, persistencia y extras

Ideas para extender más allá del roadmap:
- 🔁 Importar/exportar grabaciones desde archivo
- 🎛️ Panel de efectos (reverb, delay, distorsión)
- 🎹 Piano roll para editar las notas grabadas
- ⏱️ Cuantización de la grabación a una rejilla de compás
- 🎼 Soporte para más tipos de controlador MIDI (Launchpad, MPK, etc.)

## Licencia

MIT
