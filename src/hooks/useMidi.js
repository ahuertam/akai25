import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startAudio, triggerNote, releaseNote, releaseAll } from '../audio/synth.js'

// Status bytes del protocolo MIDI que nos interesan.
const NOTE_ON = 0x90
const NOTE_OFF = 0x80

const DEVICE_STORAGE_KEY = 'akai25.midiDevice'

/** Lee el dispositivo persistido en localStorage (o null). */
function readPersistedDevice() {
  try {
    return localStorage.getItem(DEVICE_STORAGE_KEY) || null
  } catch {
    return null
  }
}

/**
 * Hook que gestiona la conexión MIDI y la traduce a llamadas al sintetizador.
 *
 * Argumentos:
 *   - onNoteOn:  callback opcional (midi, velocity) llamado en cada Note On.
 *   - onNoteOff: callback opcional (midi) llamado en cada Note Off.
 *
 * Devuelve:
 *   - isReady:   true cuando el usuario hizo clic en "Conectar".
 *   - deviceName: nombre del dispositivo EFFECTIVAMENTE activo
 *                 (el seleccionado o el primero disponible si no hay selección).
 *   - activeNotes: Set<number> con las notas MIDI actualmente presionadas.
 *   - error:     mensaje de error legible (o null).
 *   - start():   función a llamar desde un gesto de usuario para inicializar.
 *   - playNote(midi, velocity): dispara una nota "virtual" (mismo efecto que
 *                               un Note On MIDI real; útil para el clic en el
 *                               teclado virtual).
 *   - stopNote(midi): equivalente a un Note Off MIDI.
 *   - inputs:    array [{ id, name }] con todos los inputs MIDI disponibles.
 *   - selectedInputId: id del input que está procesando eventos (o null).
 *   - selectInput(id): fija el input activo (para cuando hay 2+ dispositivos).
 *   - inputCount: número de inputs MIDI conectados.
 */
export function useMidi({ onNoteOn, onNoteOff } = {}) {
  const [isReady, setIsReady] = useState(false)
  const [inputs, setInputs] = useState([]) // [{ id, name }]
  const [selectedInputId, setSelectedInputId] = useState(readPersistedDevice)
  const [activeNotes, setActiveNotes] = useState(new Set())
  const [error, setError] = useState(null)

  // Mantenemos referencias para no recrear listeners en cada render.
  const midiAccessRef = useRef(null)
  const inputsRef = useRef(new Map()) // id -> MIDIInput

  // Refs a los callbacks externos para que el handler siempre vea la versión
  // más reciente sin necesidad de re-suscribirse a onmidimessage.
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  useEffect(() => {
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [onNoteOn, onNoteOff])

  // El id "efectivo" es el seleccionado por el usuario, o el primero
  // disponible si la selección desapareció. Lo derivamos en render (no
  // con un effect + setState) para evitar renders en cascada.
  const effectiveSelectedInputId = useMemo(() => {
    if (inputs.length === 0) return null
    if (selectedInputId && inputs.some((i) => i.id === selectedInputId)) {
      return selectedInputId
    }
    return inputs[0].id
  }, [inputs, selectedInputId])

  // El handler MIDI (registrado una sola vez por input) lee el id efectivo
  // desde un ref. Mantenemos el ref sincronizado con el valor derivado.
  const effectiveSelectedInputIdRef = useRef(effectiveSelectedInputId)
  useEffect(() => {
    effectiveSelectedInputIdRef.current = effectiveSelectedInputId
  }, [effectiveSelectedInputId])

  // Persiste la selección del usuario (no la efectiva).
  useEffect(() => {
    try {
      if (selectedInputId) {
        localStorage.setItem(DEVICE_STORAGE_KEY, selectedInputId)
      } else {
        localStorage.removeItem(DEVICE_STORAGE_KEY)
      }
    } catch {
      // localStorage no disponible → ignorar.
    }
  }, [selectedInputId])

  // Lógica de Note On/Off extraída para reutilizarla desde el handler MIDI
  // y desde el teclado virtual (clic del ratón). Mantener una sola ruta
  // garantiza que el click se graba igual que una nota real y que el visual
  // se actualiza de forma consistente.
  const playNote = useCallback((midi, velocity = 0.8) => {
    triggerNote(midi, velocity)
    setActiveNotes((prev) => {
      if (prev.has(midi)) return prev
      const next = new Set(prev)
      next.add(midi)
      return next
    })
    onNoteOnRef.current?.(midi, velocity)
  }, [])

  const stopNote = useCallback((midi) => {
    releaseNote(midi)
    setActiveNotes((prev) => {
      if (!prev.has(midi)) return prev
      const next = new Set(prev)
      next.delete(midi)
      return next
    })
    onNoteOffRef.current?.(midi)
  }, [])

  // Suscribe un input MIDI al handler de mensajes.
  const attachInput = useCallback((input) => {
    if (inputsRef.current.has(input.id)) return

    input.onmidimessage = (event) => {
      // event.target es el MIDIInput que recibió el mensaje.
      // Si el usuario eligió un dispositivo concreto, ignoramos los demás.
      const active = effectiveSelectedInputIdRef.current
      if (active && event.target.id !== active) return

      const [statusByte, note, rawVelocity] = event.data
      const command = statusByte & 0xf0
      const velocity = rawVelocity / 127

      if (command === NOTE_ON && rawVelocity > 0) {
        playNote(note, velocity)
      } else if (command === NOTE_OFF || (command === NOTE_ON && rawVelocity === 0)) {
        stopNote(note)
      }
      // Ignoramos el resto (control change, pitch bend, etc.) por ahora.
    }

    inputsRef.current.set(input.id, input)
  }, [playNote, stopNote])

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
        if (removed) removed.onmidimessage = null
        inputsRef.current.delete(id)
      }
    }

    // Actualiza la lista observable de inputs.
    const list = Array.from(access.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name || '(sin nombre)',
    }))
    setInputs(list)
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
      for (const input of inputs.values()) {
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

  const selectInput = useCallback((id) => {
    setSelectedInputId(id)
  }, [])

  // Nombre del dispositivo que está activo AHORA.
  const activeInput = inputs.find((i) => i.id === effectiveSelectedInputId)
  const deviceName = activeInput ? activeInput.name : null

  return {
    isReady,
    deviceName,
    activeNotes,
    error,
    inputs,
    selectedInputId: effectiveSelectedInputId,
    selectInput,
    inputCount: inputs.length,
    start,
    // API pública para disparar notas "virtuales" (p.ej. clic en el
    // teclado virtual). Pasa por el mismo camino que un mensaje MIDI
    // real, así que el visual y la grabación se actualizan igual.
    playNote,
    stopNote,
  }
}
