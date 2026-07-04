/**
 * Controles de transporte: Grabar, Parar, Reproducir + Bucle.
 * Los botones se deshabilitan según el estado actual para evitar acciones
 * inválidas (p.ej. grabar dos veces a la vez, reproducir durante una grabación).
 */
export function Transport({
  isRecording,
  isPlaying,
  eventCount,
  loop,
  onLoopChange,
  onRecord,
  onStop,
  onPlay,
}) {
  const canRecord = !isRecording && !isPlaying
  // Stop siempre habilitado: además de parar grabación/reproducción, hace
  // de "panic button" y silencia cualquier nota colgada (p.ej. un envelope
  // abierto en Monophonic/Sampler que no se liberó por un bug de release).
  const canStop = true
  const canPlay = !isRecording && !isPlaying && eventCount > 0

  return (
    <div className="transport" role="group" aria-label="Controles de transporte">
      <button
        type="button"
        className={`transport__button transport__button--record${isRecording ? ' is-active' : ''}`}
        onClick={onRecord}
        disabled={!canRecord}
        aria-label="Iniciar grabación"
      >
        <span className="transport__icon" aria-hidden="true">●</span>
        <span>Grabar</span>
      </button>

      <button
        type="button"
        className="transport__button transport__button--stop"
        onClick={onStop}
        disabled={!canStop}
        aria-label="Detener grabación o reproducción"
      >
        <span className="transport__icon" aria-hidden="true">■</span>
        <span>Parar</span>
      </button>

      <button
        type="button"
        className={`transport__button transport__button--play${isPlaying ? ' is-active' : ''}`}
        onClick={onPlay}
        disabled={!canPlay}
        aria-label="Reproducir grabación"
      >
        <span className="transport__icon" aria-hidden="true">▶</span>
        <span>Reproducir</span>
      </button>

      <label className={`transport__loop${loop ? ' is-active' : ''}`}>
        <input
          type="checkbox"
          checked={loop}
          onChange={(e) => onLoopChange(e.target.checked)}
          disabled={eventCount === 0}
          aria-label="Reproducir en bucle"
        />
        <span className="transport__loop-icon" aria-hidden="true">↻</span>
        <span>Bucle</span>
      </label>

      <div className="transport__status" aria-live="polite">
        {isRecording && <span className="transport__badge transport__badge--rec">● REC</span>}
        {isPlaying && <span className="transport__badge transport__badge--play">▶ PLAY</span>}
        {!isRecording && !isPlaying && (
          <span className="transport__count">
            {eventCount === 0
              ? 'Sin grabación'
              : `${eventCount} ${eventCount === 1 ? 'nota grabada' : 'notas grabadas'}`}
          </span>
        )}
      </div>
    </div>
  )
}
