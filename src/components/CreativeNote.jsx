import { useState } from 'react'

/**
 * Rectángulo de una nota en el lane. Maneja:
 *   - click → selecciona (delegado al padre via onSelect)
 *   - doble-click → borra (delegado al padre via onDelete)
 *   - drag horizontal sobre la nota → arrastra para cambiar localTime
 *     (drag local, sin tocar el state hasta pointerup; commit via
 *     onUpdate). Solo se permite drag sobre la nota SELECCIONADA.
 *
 * Props:
 *   - event: { localTime, duration, note }
 *   - loopLength (cycleLength): ancho del rango activo (loopEnd - loopStart)
 *   - loopStart: offset absoluto del inicio del rango visible
 *   - isSelected: si está seleccionada (para permitir drag)
 *   - color: color del track
 *   - onSelect, onDelete, onUpdate(updates): handlers al padre
 */
export function CreativeNote({
  event,
  loopLength,
  loopStart,
  isSelected,
  color,
  onSelect,
  onDelete,
  onUpdate,
}) {
  // localTime mostrado mientras se arrastra. null cuando no hay drag.
  // Solo aplicamos el offset visual durante pointermove; el commit
  // (updateEvent) se hace en pointerup. Así evitamos 60 re-renders por
  // segundo martillando setTracks durante el drag.
  const [dragTime, setDragTime] = useState(null)

  const handlePointerDown = (e) => {
    // Solo arrastrable si está seleccionada — sin esto un click en una
    // nota sin seleccionar (que debería seleccionar) entraría en drag.
    if (!isSelected) return
    e.preventDefault()           // evita selección de texto nativa
    e.stopPropagation()          // no propaga al track (no lo activa)

    const startX = e.clientX
    // El lane es el parent de la nota. Medimos su ancho en px UNA vez
    // al pointerdown para convertir el delta de pixeles a tiempo.
    const laneEl = e.currentTarget.parentElement
    const laneWidth = laneEl ? laneEl.clientWidth : 1

    const onMove = (ev) => {
      const deltaPx = ev.clientX - startX
      const deltaSec = (deltaPx / laneWidth) * loopLength
      setDragTime(event.localTime + deltaSec)
    }

    const onUp = (ev) => {
      const deltaPx = ev.clientX - startX
      const deltaSec = (deltaPx / laneWidth) * loopLength
      // Solo commit si el usuario se movió más de 1ms (umbral pequeño para
      // tolerar el jitter del ratón en un click normal).
      if (Math.abs(deltaSec) > 0.001) {
        const newTime = Math.max(0, Math.min(180, event.localTime + deltaSec))
        onUpdate?.({ localTime: newTime })
      }
      setDragTime(null)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const displayTime = dragTime ?? event.localTime
  // Posición en el lane como porcentaje. Clamp a [0, 100] para que
  // arrastres fuera del rango visible queden anclados al borde.
  const left = Math.max(
    0,
    Math.min(100, ((displayTime - loopStart) / loopLength) * 100),
  )
  const width = Math.max((event.duration / loopLength) * 100, 1.5)

  return (
    <div
      className={
        'creative-track__note' +
        (isSelected ? ' creative-track__note--selected' : '') +
        (dragTime !== null ? ' creative-track__note--dragging' : '')
      }
      style={{ left: `${left}%`, width: `${width}%`, background: color }}
      title={`Nota @ ${displayTime.toFixed(2)}s · click para editar, doble-click para borrar, arrastrar para mover`}
      onPointerDown={handlePointerDown}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onDelete?.()
      }}
    />
  )
}