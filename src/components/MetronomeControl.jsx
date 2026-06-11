/**
 * Control del metrónomo: toggle + entrada numérica de BPM + indicador
 * visual que pulsa en cada tick.
 *
 * El indicador está siempre presente (incluso con el metrónomo apagado) para
 * que la fila se vea estable; solo cambia de color cuando `isTicking`.
 */
export function MetronomeControl({
  isEnabled,
  isTicking,
  bpm,
  minBpm,
  maxBpm,
  onToggle,
  onBpmChange,
}) {
  return (
    <div className="metronome" role="group" aria-label="Metrónomo">
      <label className="control control--inline">
        <input
          type="checkbox"
          className="metronome__toggle"
          checked={isEnabled}
          onChange={onToggle}
          aria-label="Activar metrónomo"
        />
        <span className="control__label">Metrónomo</span>
      </label>

      <span
        className={`metronome__pulse${isTicking ? ' is-active' : ''}${isEnabled ? ' is-on' : ''}`}
        aria-hidden="true"
        title={isEnabled ? 'Click del metrónomo' : 'Metrónomo apagado'}
      />

      <label className="control control--inline metronome__bpm">
        <span className="control__label">BPM</span>
        <input
          type="number"
          className="control__number"
          value={bpm}
          min={minBpm}
          max={maxBpm}
          step={1}
          onChange={(e) => onBpmChange(e.target.value)}
          disabled={!isEnabled}
          aria-label="Tempo en pulsos por minuto"
        />
      </label>
    </div>
  )
}
