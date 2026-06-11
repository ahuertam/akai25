/**
 * Selector de dispositivo MIDI. Solo se muestra cuando hay 2+ inputs
 * conectados; con un solo dispositivo no aporta valor y ocupa espacio.
 *
 * El "value" del <select> es el id del input. Si el dispositivo activo
 * no está en la lista (se desconectó), se muestra un placeholder.
 */
export function DeviceSelector({ inputs, selectedInputId, onSelect }) {
  if (inputs.length < 2) return null

  return (
    <label className="control control--select">
      <span className="control__label">Dispositivo</span>
      <select
        className="control__select"
        value={selectedInputId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Seleccionar dispositivo MIDI"
      >
        {inputs.map((input) => (
          <option key={input.id} value={input.id}>
            {input.name}
          </option>
        ))}
      </select>
    </label>
  )
}
