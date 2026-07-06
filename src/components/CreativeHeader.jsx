/**
 * Cabecera del modo creative. Contiene:
 *  - Botón "Volver" (esquina superior izquierda, fuera del header).
 *  - Regla de tiempos con marcas por negra.
 *  - Transport del creative (Play/Stop + Clear all).
 *
 * Se separa del header global para que el "Volver" esté siempre visible
 * aunque la cabecera principal haga scroll.
 */
export function CreativeHeader({
  loopLength,
  isPlaying,
  onPlay,
  onStop,
  onClearAll,
  onBack,
  onExport,
  isExporting,
  hasEvents,
  bpm,
}) {
  // Una marca por negra: 8 negras en el loop. labels = ["1", "1.2", ...].
  const beatLabels = Array.from({ length: LOOP_BEATS }, (_, i) => {
    const bar = Math.floor(i / 4) + 1
    const beat = (i % 4) + 1
    return `${bar}.${beat}`
  })

  return (
    <div className="creative-header">
      <button
        type="button"
        className="back-button"
        onClick={onBack}
        aria-label="Volver a la vista normal"
      >
        ← Volver
      </button>

      <div className="creative-header__center">
        <div className="creative-header__rule" aria-hidden="true">
          {beatLabels.map((label, i) => (
            <div
              key={label}
              className={`creative-header__beat${i % 4 === 0 ? ' creative-header__beat--bar' : ''}`}
              style={{ left: `${(i / LOOP_BEATS) * 100}%` }}
            >
              <span className="creative-header__beat-label">{label}</span>
            </div>
          ))}
        </div>
        <div className="creative-header__meta">
          Loop {LOOP_BEATS} negras · {loopLength.toFixed(2)}s · {bpm} BPM
        </div>
      </div>

      <div className="creative-header__actions">
        <button
          type="button"
          className={`creative-header__button creative-header__button--play${isPlaying ? ' is-active' : ''}`}
          onClick={isPlaying ? onStop : onPlay}
          aria-pressed={isPlaying}
        >
          {isPlaying ? '⏸ Stop' : '▶ Play'}
        </button>
        <button
          type="button"
          className={`creative-header__button creative-header__button--export${isExporting ? ' is-loading' : ''}`}
          onClick={onExport}
          disabled={!hasEvents || isExporting}
          aria-label="Exportar loop como archivo WAV"
          title={hasEvents ? 'Renderizar el loop a WAV' : 'Graba algo antes de exportar'}
        >
          {isExporting ? '⏳ Exportando…' : '⬇ Export'}
        </button>
        <button
          type="button"
          className="creative-header__button creative-header__button--clear"
          onClick={onClearAll}
          aria-label="Limpiar todas las pistas"
        >
          🗑 Clear all
        </button>
      </div>
    </div>
  )
}

const LOOP_BEATS = 8