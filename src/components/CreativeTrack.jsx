import { InstrumentSelector } from './InstrumentSelector.jsx'
import { CreativeNote } from './CreativeNote.jsx'

/**
 * Fila de una pista del modo creative. Visualización horizontal:
 *  - Cabecera con nº de pista, selector de instrumento, toggles.
 *  - Línea de tiempo donde se dibujan los eventos como rectángulos.
 *
 * Activación de pista: hacer click en CUALQUIER parte de la fila (head o
 * lane) activa la pista. Los controles internos (selector, toggles,
 * botón limpiar) reciben `stopPropagation` para que su click NO active
 * la pista accidentalmente — solo responden al control concreto.
 *
 * Props:
 *  - track: { id, instrumentId, events, overwrite, muted, color }
 *  - isActive: bool, si es la pista a la que van las notas nuevas
 *  - loopLength (cycleLength): en segundos, ancho del lane (loopEnd - loopStart)
 *  - loopStart: en segundos, offset absoluto del inicio del rango visible
 *  - available: lista de instrumentos disponibles
 *  - handlers: setInstrument, toggleOverwrite, toggleMute, clearTrack,
 *              setActiveTrack, recordEvent
 */
export function CreativeTrack({
  track,
  isActive,
  loopLength,
  loopStart,
  playheadLeft,
  selectedIndex,
  available,
  onSelectInstrument,
  onToggleOverwrite,
  onToggleMute,
  onClear,
  onDeleteEvent,
  onUpdateEvent,
  onSelectEvent,
  onActivate,
}) {
  // Helper para detener el bubble en los controles: el handler del
  // control se ejecuta igual, pero el click no llega al outer div que
  // activa la pista.
  const stop = (handler) => (e) => {
    e.stopPropagation()
    handler?.(e)
  }

  return (
    <div
      className={`creative-track${isActive ? ' creative-track--active' : ''}${track.muted ? ' creative-track--muted' : ''}`}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate?.()
        }
      }}
      style={{ '--track-color': track.color }}
    >
      <div className="creative-track__head">
        <div className="creative-track__num">T{track.id + 1}</div>
        <InstrumentSelector
          instrumentId={track.instrumentId}
          available={available}
          onChange={(id) => onSelectInstrument(track.id, id)}
          onClick={stop()}
        />
        <label
          className={`creative-track__toggle${track.overwrite ? ' is-on' : ''}`}
          title="Overwrite: vacía el track al cruzar el final del loop"
          onClick={stop()}
        >
          <input
            type="checkbox"
            checked={track.overwrite}
            onChange={() => onToggleOverwrite(track.id)}
            aria-label={`Overwrite de pista ${track.id + 1}`}
          />
          <span>OW</span>
        </label>
        <label
          className={`creative-track__toggle creative-track__toggle--mute${track.muted ? ' is-on' : ''}`}
          title="Silenciar pista"
          onClick={stop()}
        >
          <input
            type="checkbox"
            checked={track.muted}
            onChange={() => onToggleMute(track.id)}
            aria-label={`Mute de pista ${track.id + 1}`}
          />
          <span>M</span>
        </label>
        <button
          type="button"
          className="creative-track__clear"
          onClick={stop(() => onClear(track.id))}
          title="Limpiar pista"
          aria-label={`Limpiar pista ${track.id + 1}`}
        >
          ✕
        </button>
      </div>

      <div className="creative-track__lane">
        {/* ponytail: el playhead VA DENTRO del lane (no como hijo de
            .creative-tracks). Antes se posicionaba contra el contenedor
            completo, pero el lane NO ocupa todo el ancho — el head de
            360px + gap de 12px está a la izquierda. El playhead al 50%
            quedaba en el centro del contenedor y los rectángulos al 50%
            en el centro del lane: no coincidían. Cada lane ahora tiene
            su propia línea, todas sincronizadas al mismo playheadLeft. */}
        <div
          className="creative-playhead"
          style={{ left: `${playheadLeft}%` }}
          aria-hidden="true"
        />
        {track.events.map((evt, i) => {
          // CreativeNote encapsula drag + click + doble-click. El padre
          // solo le pasa callbacks que delegan al hook.
          return (
            <CreativeNote
              key={i}
              event={evt}
              loopLength={loopLength}
              loopStart={loopStart}
              isSelected={selectedIndex === i}
              color={track.color}
              onSelect={() => onSelectEvent?.(track.id, i)}
              onDelete={() => onDeleteEvent?.(track.id, i)}
              onUpdate={(updates) => onUpdateEvent?.(track.id, i, updates)}
            />
          )
        })}
      </div>
    </div>
  )
}