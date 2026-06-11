/**
 * Selector de instrumento. Usa un `<select>` nativo para mantenerlo accesible
 * y ligero; el `<option>` muestra el nombre y el `title` (tooltip) muestra
 * la descripción al pasar el cursor.
 */
export function InstrumentSelector({ instrumentId, available, onChange }) {
  return (
    <label className="control control--select">
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
