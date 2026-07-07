/**
 * Cabecera del modo creative. Contiene:
 *  - Botón "Volver" (esquina superior izquierda, fuera del header).
 *  - Regla de tiempos con marcas por negra + playhead sincronizado.
 *  - Inputs de inicio/final del loop (en segundos, hasta 3 min).
 *  - Transport del creative (Play/Stop + Export + Clear all).
 *
 * Se separa del header global para que el "Volver" esté siempre visible
 * aunque la cabecera principal haga scroll.
 */
export function CreativeHeader({
  loopStart,
  loopEnd,
  cycleLength,
  isPlaying,
  playheadLeft,
  onPlay,
  onStop,
  onClearAll,
  onBack,
  onExport,
  isExporting,
  exportError,
  hasEvents,
  onLoopStartChange,
  onLoopEndChange,
  bpm,
}) {
  // ponytail: el ruler muestra el tiempo en SEGUNDOS con un paso
  // adaptativo para que la densidad sea legible. Antes generábamos
  // `cycleBeatsTotal` labels (300 para 180s @ 100bpm → ilegible) y
  // las posicionábamos con `left: X%` sin centrar, así que la última
  // se cortaba a la mitad por el `overflow: hidden`. Ahora: paso = X
  // segundos (sub-muestreo logarítmico), labels centradas con
  // `translateX(-50%)` y formato en segundos. Aim: 8-12 labels visibles
  // en cualquier rango.
  const stepSec = (() => {
    if (cycleLength <= 4) return 0.5
    if (cycleLength <= 8) return 1
    if (cycleLength <= 16) return 2
    if (cycleLength <= 32) return 4
    if (cycleLength <= 64) return 8
    if (cycleLength <= 120) return 10
    return 20 // 120-180s
  })()
  const visibleSeconds = []
  for (let s = 0; s <= cycleLength + 0.0001; s += stepSec) {
    visibleSeconds.push(Math.round(s * 100) / 100)
  }
  // Formato: < 10s → "X.Ys", >= 10s → "Xs" sin decimales para
  // reducir anchura de label. Para loopStart > 0 sumamos el offset
  // (el ruler muestra tiempo absoluto, no relativo al loop).
  const formatLabel = (s) => {
    const abs = loopStart + s
    return s < 10 ? `${abs.toFixed(1)}s` : `${Math.round(abs)}s`
  }

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
          {visibleSeconds.map((sec) => {
            // Etiqueta "mayor" (cada 4 pasos o la primera/última) en
            // color más fuerte para dar estructura visual al ruler.
            const index = visibleSeconds.indexOf(sec)
            const isMajor = index % 4 === 0 || sec === 0
            return (
              <div
                key={sec}
                className={`creative-header__beat${isMajor ? ' creative-header__beat--bar' : ''}`}
                style={{
                  left: cycleLength === 0 ? 0 : `${(sec / cycleLength) * 100}%`,
                }}
              >
                <span className="creative-header__beat-label">{formatLabel(sec)}</span>
              </div>
            )
          })}
          {/* ponytail: el playhead en el ruler usa el MISMO porcentaje
              que los playheads de las lanes — así se ven los tres
              sincronizados al moverse. Sin transition CSS (eso lo
              aprendimos en v0.5.0). */}
          <div
            className="creative-header__playhead"
            style={{ left: `${playheadLeft}%` }}
          />
        </div>
        <div className="creative-header__meta">
          {/* Rango del loop editable: inputs numéricos directos en
              segundos (max 180s = 3 min). Reemplaza el antiguo control
              de loopBeats (negras) que era demasiado rígido. */}
          <div className="creative-header__time-range">
            <label className="creative-header__time-field">
              <span>Inicio</span>
              <input
                type="number"
                min="0"
                max="179.9"
                step="0.1"
                value={loopStart.toFixed(1)}
                onChange={(e) => onLoopStartChange?.(Number(e.target.value))}
                aria-label="Tiempo de inicio del loop"
              />
              <small>s</small>
            </label>
            <span className="creative-header__time-sep">→</span>
            <label className="creative-header__time-field">
              <span>Final</span>
              <input
                type="number"
                min="0.1"
                max="180"
                step="0.1"
                value={loopEnd.toFixed(1)}
                onChange={(e) => onLoopEndChange?.(Number(e.target.value))}
                aria-label="Tiempo final del loop"
              />
              <small>s</small>
            </label>
            <span className="creative-header__loop-duration">
              ({cycleLength.toFixed(1)}s)
            </span>
          </div>
          <span className="creative-header__bpm">· {bpm} BPM</span>
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
      {exportError && (
        <p className="creative-header__error" role="alert">
          ⚠ {exportError}
        </p>
      )}
    </div>
  )
}