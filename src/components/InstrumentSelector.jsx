/**
 * Selector de instrumento. Usa un `<select>` nativo para mantenerlo accesible
 * y ligero; el `<option>` muestra el nombre y el `title` (tooltip) muestra
 * la descripción al pasar el cursor.
 *
 * `onClick` (opcional) se reenvía al `<label>` exterior para que el padre
 * pueda detener la propagación — útil cuando el selector vive dentro de
 * un contenedor que reacciona al click (p.ej. CreativeTrack, donde
 * queremos que el click en el selector NO active la pista).
 */
export function InstrumentSelector({ instrumentId, available, onChange, onClick }) {
  return (
    <label className="control control--select" onClick={onClick}>
      <span className="control__label">Instrumento</span>
      <select
        className="control__select"
        value={instrumentId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Seleccionar instrumento"
      >
        {available.map((inst) => (
          <option key={inst.id} value={inst.id} title={inst.description}>
            {inst.label}
          </option>
        ))}
      </select>
    </label>
  )
}
