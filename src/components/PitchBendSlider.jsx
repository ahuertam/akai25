import { useCallback, useEffect, useRef } from 'react'

/**
 * Slider horizontal continuo con marcas y título configurables. Tres usos:
 *
 *  - Pitch bend (auto-retorno al centro al soltar): misma UX que la
 *    rueda con muelle del Akai.
 *  - Mod wheel (CC#1) → filter cutoff: sin auto-retorno, el valor se
 *    queda donde lo dejas.
 *  - Reverb wet: igual, sin auto-retorno.
 *
 * El componente escucha `pointermove` global filtrado por botón
 * presionado + posición dentro del rect, así que se activa aunque el
 * click original haya sido en otro sitio (p.ej. una tecla del teclado
 * virtual) y arrastres el cursor por encima. Sin esto, el slider se
 * queda mudo cuando hay un pointerdown activo en otro elemento.
 *
 * Props:
 *   - value:        posición actual en el rango [min..max].
 *   - min, max:     rango. Default -1..+1 (pitch bend).
 *   - onChange:     (newValue) => void en cada drag/teclado.
 *   - onRelease:    () => void al soltar el botón. Para auto-retorno,
 *                   el padre hace setValue(center) + side-effect.
 *   - title:        etiqueta pequeña arriba del slider ("Pitch", "Mod", ...).
 *   - leftLabel/rightLabel: textos en los extremos del track.
 *   - centerLabel:  texto en el centro (sólo si showCenter).
 *   - showCenter:   muestra marca + label central (default false).
 *   - ariaLabel:    descripción accesible.
 */
export function PitchBendSlider({
  value,
  min = -1,
  max = 1,
  onChange,
  onRelease,
  title,
  leftLabel,
  rightLabel,
  centerLabel,
  showCenter = false,
  ariaLabel = 'Slider',
}) {
  const trackRef = useRef(null)
  const draggingRef = useRef(false)

  const valueFromClientX = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return min
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
    return min + (pct / 100) * (max - min)
  }, [min, max])

  // Listeners globales: se enganchan si el cursor entra al rect del
  // slider con un botón presionado, sin importar dónde se originó el
  // pointerdown (típico: click en una tecla del teclado virtual y
  // arrastre al slider para doblar).
  useEffect(() => {
    const handleMove = (ev) => {
      if (ev.buttons === 0) return
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const inside =
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom
      if (!inside) return
      draggingRef.current = true
      onChange(valueFromClientX(ev.clientX))
    }
    const handleUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      onRelease?.()
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [onChange, onRelease, valueFromClientX])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    draggingRef.current = true
    onChange(valueFromClientX(e.clientX))
  }, [onChange, valueFromClientX])

  const handleKeyDown = useCallback((e) => {
    const range = max - min
    const step = range * (e.shiftKey ? 0.1 : 0.02)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      onChange(Math.max(min, value - step))
      e.preventDefault()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      onChange(Math.min(max, value + step))
      e.preventDefault()
    } else if (e.key === 'Home') {
      onChange(min)
      e.preventDefault()
    } else if (e.key === 'End') {
      onChange(max)
      e.preventDefault()
    }
  }, [onChange, value, min, max])

  const pct = ((value - min) / (max - min)) * 100
  const centerPct = ((0 - min) / (max - min)) * 100

  return (
    <div
      ref={trackRef}
      className="pitch-bend"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      {title && <span className="pitch-bend__title">{title}</span>}
      <div className="pitch-bend__track" />
      {showCenter && (
        <>
          <div className="pitch-bend__center" style={{ left: `${centerPct}%` }} />
          {centerLabel && (
            <span
              className="pitch-bend__label pitch-bend__label--center"
              style={{ left: `${centerPct}%` }}
            >
              {centerLabel}
            </span>
          )}
        </>
      )}
      <div className="pitch-bend__handle" style={{ left: `${pct}%` }} />
      {leftLabel && <span className="pitch-bend__label pitch-bend__label--left">{leftLabel}</span>}
      {rightLabel && <span className="pitch-bend__label pitch-bend__label--right">{rightLabel}</span>}
    </div>
  )
}