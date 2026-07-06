/**
 * Toggle visual del pedal sustain. Es un botón accesible que cambia entre
 * pisado/suelto. El estado real viene del CC#64 del MIDI; este botón
 * ofrece una alternativa cuando no hay pedal físico conectado (típico
 * en el LPK25 que sólo tiene mod wheel y pitch wheel).
 */
export function SustainToggle({ isOn, onToggle }) {
  return (
    <button
      type="button"
      className={`sustain${isOn ? ' is-on' : ''}`}
      role="switch"
      aria-checked={isOn}
      aria-label="Pedal sustain (CC#64)"
      title={isOn ? 'Sustain pisado — las notas se mantienen al soltar' : 'Sustain suelto'}
      onClick={onToggle}
    >
      <svg
        className="sustain__icon"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
      >
        {/* Pedal hacia abajo (pisado) */}
        <path
          d="M5 14h14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-5z"
          fill="currentColor"
          opacity={isOn ? 1 : 0.35}
        />
        {/* Brazo del pedal */}
        <path
          d="M12 14V8a3 3 0 0 0-3-3"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          opacity={isOn ? 1 : 0.45}
        />
        {/* Punto pivote */}
        <circle cx="12" cy="14" r="1.4" fill="currentColor" />
      </svg>
      <span className="sustain__label">Sustain</span>
    </button>
  )
}