import * as Tone from 'tone'

// Metrónomo basado en Tone.Transport. Se programa un scheduleRepeat
// que dispara un MembraneSynth (click grave) en cada cuarto de nota
// Y agenda un callback visual en Tone.Draw para que el pulso en pantalla
// coincida con el sonido que sale por los altavoces.

let clickSynth = null
let scheduledId = null
let onTickCallback = null

function ensureSynth() {
  if (!clickSynth) {
    clickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 },
    }).toDestination()
    clickSynth.volume.value = -10
  }
}

/**
 * Arranca el metrónomo.
 *  - bpm:    tempo en pulsos por minuto (el Transport se ajusta a este valor).
 *  - onTick: callback opcional que se invoca en cada tick (visual feedback).
 */
export function startMetronome(bpm, onTick) {
  ensureSynth()
  onTickCallback = onTick ?? null

  const transport = Tone.getTransport()
  transport.bpm.value = bpm

  // Limpiamos cualquier schedule anterior por seguridad.
  if (scheduledId !== null) {
    transport.clear(scheduledId)
    scheduledId = null
  }

  // scheduleRepeat dispara cada "4n" (un cuarto de nota) desde la posición
  // actual del Transport. El callback recibe el `time` del AudioContext
  // exacto en que sonará el click.
  scheduledId = transport.scheduleRepeat((time) => {
    clickSynth.triggerAttackRelease('C2', '32n', time)
    // Tone.Draw se sincroniza con requestAnimationFrame, así que este
    // callback se ejecuta en el frame de pantalla más cercano al `time`
    // de audio → la luz pulsante va pegada al click audible.
    Tone.getDraw().schedule(() => {
      if (onTickCallback) onTickCallback()
    }, time)
  }, '4n')

  // Arrancamos el Transport si no estaba ya corriendo.
  if (transport.state !== 'started') {
    transport.start()
  }
}

/** Detiene el metrónomo. No detiene el Transport (puede estar usándose para
 *  reproducción). */
export function stopMetronome() {
  const transport = Tone.getTransport()
  if (scheduledId !== null) {
    transport.clear(scheduledId)
    scheduledId = null
  }
  onTickCallback = null
}

/** Indica si el metrónomo está sonando. */
export function isMetronomeRunning() {
  return scheduledId !== null
}
