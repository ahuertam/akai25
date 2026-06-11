La aplicación  es una estación de trabajo musical web (Web DAW) ligera que actúa como un puente directo entre tu teclado Akai LPK25 y el navegador, permitiéndote tocar sintetizadores virtuales en tiempo real con latencia mínima gracias a la Web MIDI API. Además de ofrecer una interfaz visual interactiva donde un teclado virtual se ilumina en respuesta a tus ejecuciones, la herramienta integra funcionalidades de grabación y reproducción que permiten capturar tus ideas musicales, escucharlas y experimentar con diferentes sonidos, todo ello corriendo nativamente en una pestaña de Chrome o Edge sin necesidad de instalar ningún driver o software adicional.



Stack Tecnológico recomendado ( puedes sugerir cambios):

Vite (para crear el proyecto React rápido).
Tone.js (maneja la complejidad matemática del audio y el reloj).
Standard CSS (no necesitas Tailwind ni librerías de UI complejas para esto, manténlo ligero).

🚀 Hito 1: La Fundación (Conexión y Sonido)
Objetivo: Lograr que al presionar una tecla de tu Akai LPK25, suene una nota en el navegador.

Configuración del Entorno:
Crear proyecto con Vite (npm create vite@latest).
Instalar dependencias: npm install tone.
Conexión MIDI (Web MIDI API):
Crear un servicio o hook (useMidi) que detecte los dispositivos conectados.
Solicitar permisos al navegador (navigator.requestMIDIAccess).
Escuchar el evento midimessage.
Síntesis de Audio (Tone.js):
Inicializar un sintetizador básico (Tone.PolySynth).
Importante: Crear un botón de "Iniciar Audio" (los navegadores bloquean el sonido hasta que el usuario hace clic).
Lógica de Eventos:
Detectar Note On (144) para llamar a synth.triggerAttack().
Detectar Note Off (128) para llamar a synth.triggerRelease().
✅ Entregable: Una pantalla vacía con un botón "Conectar". Al tocar el Akai, escuchas un sonido tipo "beep" sintético.

🎹 Hito 2: Interfaz Visual y Feedback
Objetivo: Crear una interfaz gráfica que reaccione a tu ejecución (feedback visual).

Diseño del Teclado Virtual:
Crear un componente <Keyboard />.
Renderizar teclas blancas y negras usando HTML/CSS (Flexbox o Grid).
Mapear los códigos MIDI (ej. 60 = C4) a las teclas visuales.
Gestión de Estado en React:
Mantener un estado activeNotes (un array o Set) en el componente principal.
Cuando el MIDI envía una nota, agregarla al estado; cuando se suelta, quitarla.
Animación:
Usar CSS condicional (ej. clase .active) para cambiar el color de la tecla presionada en pantalla.
Mostrar el nombre de la nota en pantalla (ej. "C#4").
✅ Entregable: Ves un teclado de piano en pantalla. Cuando tocas el Akai, las teclas virtuales se iluminan al ritmo que tocas.

⏺️ Hito 3: Grabación y Secuenciador
Objetivo: Implementar la lógica para grabar lo que tocas y reproducirlo.

Estructura de Datos de Grabación:
Definir qué guardar: { note: "C4", startTime: 0.5, duration: 0.2, velocity: 0.8 }.
Usar Tone.now() o performance.now() para capturar el tiempo exacto relativo al inicio de la grabación.
Controles de Transporte:
Añadir botones: Grabar, Parar, Reproducir.
Lógica del botón Grabar:
Limpiar el array de eventos.
Marcar isRecording = true.
Guardar el timeStart.
Reproducción (Playback):
Al presionar reproducir, iterar sobre el array de eventos grabados.
Usar Tone.Transport para programar los eventos en el futuro exacto en que ocurrieron.
Sincronizar el audio con la visualización (que las teclas se muevan solas al reproducir).
✅ Entregable: Puedes tocar una melodía, presionar "Grabar", volver a tocarla, y luego darle a "Reproducir" para escuchar la melodía y ver las teclas moverse solas.

✨ Hito 4: Pulido, Persistencia y Extras
Objetivo: Mejorar la experiencia de usuario y hacer la app robusta.

Selección de Sonidos:
Permitir cambiar el tipo de sintetizador (Piano, Synth, Bass) usando los instrumentos de Tone.js o cargar samples simples.
Persistencia (Guardar):
Convertir el array de la grabación a JSON y permitir "Descargar MIDI" (formato estándar) o simplemente "Guardar en LocalStorage" para que no se pierda al recargar.
Manejo de Errores:
¿Qué pasa si desconectas el Akai mientras tocas? (Manejar evento statechange de MIDI).
Selector de dispositivo MIDI (si tienes más de uno conectado).
Estilos y UX:
Añadir un metrónomo (click) para grabar con ritmo.
Diseño responsive para que se vea bien en móvil (aunque el MIDI solo funcione en PC).
✅ Entregable: Una "Mini DAW" (Digital Audio Workstation) funcional, con cambio de instrumentos y capacidad de guardar tus ideas.

