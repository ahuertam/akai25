/** Formatea una fecha como "YYYY-MM-DD_HH-MM-SS" apta para nombre de archivo. */
function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/** Construye el JSON descargable con metadatos básicos. */
function buildRecordingFile(events) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    eventCount: events.length,
    events,
  }
}

/**
 * Botones de persistencia: descargar la grabación actual a un .json y
 * limpiar la grabación. La carga desde archivo (upload) no se incluye para
 * mantener la API mínima, pero la función `loadRecording` del hook lo
 * soporta si en el futuro se quiere añadir.
 */
export function PersistenceControls({
  events,
  isRecording,
  isPlaying,
  onClear,
}) {
  const hasEvents = events.length > 0

  const handleDownload = () => {
    if (!hasEvents) return
    const data = buildRecordingFile(events)
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const filename = `akai25-recording-${timestampForFilename()}.json`

    // Creamos un <a> temporal, simulamos el clic y revocamos el URL.
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const disabled = isRecording || isPlaying || !hasEvents

  return (
    <div className="persistence" role="group" aria-label="Persistencia">
      <button
        type="button"
        className="control__button control__button--secondary"
        onClick={handleDownload}
        disabled={!hasEvents}
        aria-label="Descargar grabación como archivo JSON"
        title="Guarda la grabación como .json en tu equipo"
      >
        <span className="control__icon" aria-hidden="true">⬇</span>
        <span>Descargar</span>
      </button>

      <button
        type="button"
        className="control__button control__button--danger"
        onClick={onClear}
        disabled={disabled}
        aria-label="Borrar la grabación actual"
        title={hasEvents ? 'Borra la grabación (también del almacenamiento local)' : 'No hay grabación'}
      >
        <span className="control__icon" aria-hidden="true">🗑</span>
        <span>Limpiar</span>
      </button>
    </div>
  )
}
