// ponytail: encoder WAV PCM 16-bit mínimo (~40 líneas). Sin librería
// externa para no añadir ~50KB a un bundle que ya pasa de 500KB.
// Suficiente para exportar loops del modo creative — cualquier DAW lo
// abre y el navegador lo reproduce directamente.

/**
 * Convierte un AudioBuffer (Web Audio API) en un ArrayBuffer con bytes
 * WAV PCM 16-bit estéreo/mono según el buffer original.
 * @param {AudioBuffer} buffer
 * @returns {ArrayBuffer}
 */
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  // 44 bytes de cabecera RIFF/fmt/data + muestras interleaved de 16 bits.
  const length = 44 + buffer.length * numChannels * 2
  const out = new ArrayBuffer(length)
  const view = new DataView(out)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, length - 8, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)            // tamaño del chunk fmt (16 para PCM)
  view.setUint16(20, 1, true)             // formato = PCM
  view.setUint16(22, numChannels, true)   // canales
  view.setUint32(24, sampleRate, true)    // sample rate
  view.setUint32(28, sampleRate * numChannels * 2, true) // byte rate
  view.setUint16(32, numChannels * 2, true)              // block align
  view.setUint16(34, 16, true)            // bits por muestra
  writeString(view, 36, 'data')
  view.setUint32(40, length - 44, true)   // tamaño del chunk data

  const channels = []
  for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i))

  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Clip [-1, 1] y convierte a int16 little-endian.
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      offset += 2
    }
  }
  return out
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}