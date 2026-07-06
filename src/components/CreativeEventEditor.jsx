import { useEffect, useRef, useState } from 'react'
import { midiToNoteName } from '../utils/notes.js'

/**
 * Panel flotante para editar los parámetros de un evento seleccionado:
 *   - time (segundos dentro del loop, 0..loopLength)
 *   - duration (segundos, 0.01..loopLength)
 *   - velocity (0..1)
 *
 * También muestra el nombre de la nota y el botón de borrar.
 *
 * Props:
 *  - event: el evento a editar { note, localTime, duration, velocity }
 *  - loopLength: tope para time / duration
 *  - trackColor: accent del track
 *  - onChange(updates): confirma cambios (commitea al salir del input o
 *    pulsar Enter). El debounce evita martillar el state cada keystroke.
 *  - onDelete(): borra el evento
 *  - onClose(): deselecciona (Escape o click fuera)
 */
export function CreativeEventEditor({
  event,
  loopLength,
  trackColor,
  onChange,
  onDelete,
  onClose,
}) {
  // ponytail: el padre debe pasar una `key` única (ej. `${trackId}-${idx}`)
  // para que React desmonte y remonte el editor cuando cambia el evento
  // seleccionado. Así el draft se inicializa limpio sin necesidad de
  // sincronizarlo con useEffect (que dispara el linter de cascading
  // renders). El draft es copia local: commit() empuja los cambios al
  // padre con debounce de 250ms y también en blur / Enter.
  const [draft, setDraft] = useState({
    localTime: event.localTime,
    duration: event.duration,
    velocity: event.velocity,
    note: event.note,
  })
  const debounceRef = useRef(null)

  // Cleanup del debounce al desmontar.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  // Escape cierra el panel; Enter commitea.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = () => {
    onChange({
      localTime: Number(draft.localTime),
      duration: Number(draft.duration),
      velocity: Number(draft.velocity),
      note: Math.round(Number(draft.note)),
    })
  }

  const update = (field) => (e) => {
    const value = e.target.value
    setDraft((d) => ({ ...d, [field]: value }))
    // El lint marca la lectura/escritura de debounceRef.current como
    // "access during render" porque `update` se crea en el body del
    // componente. Falso positivo: solo se ejecuta desde onChange.
    // eslint-disable-next-line react-hooks/refs
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(commit, 250)
  }

  const onKeyDownInput = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      e.target.blur()
    }
  }

  return (
    <div
      className="creative-event-editor"
      style={{ '--track-color': trackColor }}
      role="dialog"
      aria-label="Editar evento"
      // Evitar que cualquier click dentro del editor se propague al
      // track y lo deseleccione (CreativeMode tiene el handler de
      // "click fuera" para cerrar).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="creative-event-editor__title">
        Editar nota
        <button
          type="button"
          className="creative-event-editor__close"
          onClick={onClose}
          aria-label="Cerrar editor"
        >
          ✕
        </button>
      </div>

      <label className="creative-event-editor__field">
        <span>Nota</span>
        <input
          type="text"
          value={`${midiToNoteName(draft.note)} (${draft.note})`}
          readOnly
          aria-readonly="true"
        />
      </label>

      <label className="creative-event-editor__field">
        <span>Tiempo (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          max={loopLength}
          value={Number(draft.localTime).toFixed(2)}
          onChange={update('localTime')}
          onBlur={commit}
          onKeyDown={onKeyDownInput}
        />
      </label>

      <label className="creative-event-editor__field">
        <span>Duración (s)</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={loopLength}
          value={Number(draft.duration).toFixed(2)}
          onChange={update('duration')}
          onBlur={commit}
          onKeyDown={onKeyDownInput}
        />
      </label>

      <label className="creative-event-editor__field">
        <span>Velocity</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={Number(draft.velocity).toFixed(2)}
          onChange={update('velocity')}
          onBlur={commit}
          onKeyDown={onKeyDownInput}
        />
      </label>

      <div className="creative-event-editor__actions">
        <button
          type="button"
          className="creative-event-editor__btn creative-event-editor__btn--danger"
          onClick={onDelete}
        >
          Borrar
        </button>
        <button
          type="button"
          className="creative-event-editor__btn"
          onClick={commit}
        >
          Guardar
        </button>
      </div>
    </div>
  )
}