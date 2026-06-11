import { useCallback, useEffect, useRef, useState } from 'react'
import { startAudio, triggerNote, releaseNote, releaseAll } from '../audio/synth.js'

// Status bytes del protocolo MIDI que nos interesan.
const NOTE_ON = 0x90
const NOTE_OFF = 0x80

/**
 * Hook que gestiona la conexión MIDI y la traduce a llamadas al sintetizador.
 *
 * Argumentos:
 *   - onNoteOn:  callback opcional (midi, velocity) llamado en cada Note On.
 *                Útil para que el módulo de grabación se entere de los eventos.
 *   - onNoteOff: callback opcional (midi) llamado en cada Note Off.
 *
 * Devuelve:
 *   - isReady:   true cuando el usuario hizo clic en "Conectar" y se concedió acceso.
 *   - deviceName: nombre del primer input MIDI detectado (null si no hay).
 *   - activeNotes: Set<number> con las notas MIDI actualmente presionadas.
 *   - error:     mensaje de error legible (o null).
 *   - start():   función a llamar desde un gesto de usuario para inicializar todo.
 *   - inputCount: número de inputs MIDI conectados (útil para feedback).
 */
export function useMidi({ onNoteOn, onNoteOff } = {}) {
  const [isReady, setIsReady] = useState(false)
  const [deviceName, setDeviceName] = useState(null)
  const [activeNotes, setActiveNotes] = useState(new Set())
  const [error, setError] = useState(null)
  const [inputCount, setInputCount] = useState(0)

  // Mantenemos referencias para no recrear listeners en cada render.
  const midiAccessRef = useRef(null)
  const inputsRef = useRef(new Map()) // id -> { input, name }

  // Refs a los callbacks externos para que el handler siempre vea la versión
  // más reciente sin necesidad de re-suscribirse a onmidimessage.
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  useEffect(() => {
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [onNoteOn, onNoteOff])

  // Suscribe un input MIDI al handler de mensajes.
  const attachInput = useCallback((input) => {
    if (inputsRef.current.has(input.id)) return

    input.onmidimessage = (event) => {
      const [statusByte, note, rawVelocity] = event.data
      const command = statusByte & 0xf0
      const velocity = rawVelocity / 127

      if (command === NOTE_ON && rawVelocity > 0) {
        triggerNote(note, velocity)
        setActiveNotes((prev) => {
          if (prev.has(note)) return prev
          const next = new Set(prev)
          next.add(note)
          return next
        })
        onNoteOnRef.current?.(note, velocity)
      } else if (command === NOTE_OFF || (command === NOTE_ON && rawVelocity === 0)) {
        releaseNote(note)
        setActiveNotes((prev) => {
          if (!prev.has(note)) return prev
          const next = new Set(prev)
          next.delete(note)
          return next
        })
        onNoteOffRef.current?.(note)
      }
      // Ignoramos el resto (control change, pitch bend, etc.) por ahora.
    }

    inputsRef.current.set(input.id, { input, name: input.name })
  }, [])

  // Recorre los inputs disponibles y los suscribe. También actualiza estado.
  const refreshInputs = useCallback(() => {
    const access = midiAccessRef.current
    if (!access) return

    // Limpia inputs que ya no existen.
    const currentIds = new Set()
    for (const input of access.inputs.values()) {
      currentIds.add(input.id)
      if (!inputsRef.current.has(input.id)) {
        attachInput(input)
      }
    }
    for (const id of inputsRef.current.keys()) {
      if (!currentIds.has(id)) {
        const removed = inputsRef.current.get(id)
        removed?.input?.onmidimessage === null
        inputsRef.current.delete(id)
      }
    }

    // Actualiza el nombre del primer input disponible.
    const first = access.inputs.values().next().value
    setDeviceName(first ? first.name : null)
    setInputCount(access.inputs.size)
  }, [attachInput])

  // Reaccionamos a conexiones/desconexiones en caliente.
  useEffect(() => {
    const access = midiAccessRef.current
    if (!access) return
    const handler = () => refreshInputs()
    access.onstatechange = handler
    return () => {
      access.onstatechange = null
    }
  }, [refreshInputs, isReady])

  // Limpieza al desmontar: silenciamos notas y soltamos referencias.
  useEffect(() => {
    const inputs = inputsRef.current
    return () => {
      releaseAll()
      for (const { input } of inputs.values()) {
        input.onmidimessage = null
      }
      inputs.clear()
    }
  }, [])

  /**
   * Punto de entrada para el botón "Conectar". Debe invocarse desde un
   * evento de usuario (onClick) para que el navegador conceda permisos.
   */
  const start = useCallback(async () => {
    if (isReady) return
    setError(null)

    if (typeof navigator.requestMIDIAccess !== 'function') {
      setError('Tu navegador no soporta Web MIDI API. Usa Chrome o Edge.')
      return
    }

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      midiAccessRef.current = access
      await startAudio()
      refreshInputs()
      setIsReady(true)
    } catch (err) {
      setError(`No se pudo acceder a MIDI: ${err?.message ?? err}`)
    }
  }, [isReady, refreshInputs])

  return { isReady, deviceName, activeNotes, error, inputCount, start }
}
