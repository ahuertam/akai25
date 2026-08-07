# Mejoras pendientes

## Compresión de la librería de samples

**Motivación.** Tras añadir 27 instrumentos nuevos, `public/samples/` ocupa 1.4GB (1041 archivos WAV). Casi todo el peso es porque WAV es PCM crudo sin comprimir.

**Opciones de codec** (formato mono, una pasada con `ffmpeg`):

| Formato | Bitrate | Ratio | Calidad esperable |
|---|---|---|---|
| OGG Vorbis | 128 kbps | ~14x | Inaudible para one-shots, casi inaudible para pads/loops |
| OGG Vorbis | 96 kbps | ~17x | Inaudible para drums, audible en pads sostenidos |
| MP3 | 128 kbps | ~13x | Equivalente a OGG, ligeramente más pesado |
| WAV 22.05 kHz | — | ~2x | Aceptable para drums, pérdida audible en agudos |

**Tamaño estimado tras conversión.** ~100MB (OGG 128kbps) sobre los 1.4GB actuales. Las 27 carpetas nuevas pesan ~700MB; las 30 antiguas ~700MB.

**Impacto en latencia de disparo.** Nulo. El navegador decodifica el archivo a un `AudioBuffer` (PCM en RAM) en el primer trigger. Una vez decodificado, se reproduce desde el buffer sin importar el codec original. La latencia depende del `AudioContext`, no del formato en disco.

**Calidad por tipo de sample** (referencia rápida):

- **Drums / one-shots** (kicks, snares, hats, claps, perc corta): 96 kbps ya es indistinguible del WAV. Son transientes de <500ms con poco contenido tonal sostenido.
- **Bass / leads** (notas musicales sostenidas): 128 kbps es seguro. 96 kbps empieza a perder definición de graves.
- **Pads / texturas / loops largos** (VintagePad, PanElectronica, FluteLoops, HipHopExp2, HipHopElectronic, Studio Wormbone Voice): mejor 128 kbps mínimo. Audible en mezcla por encima de 96 kbps.
- **Recomendación mixta**: 128 kbps universal — peor caso ~3% más pesado que 96, calidad sin compromisos.

**Alcance** (a decidir):

- **Solo las 27 carpetas nuevas**: ahorra ~700MB. Deja las 30 originales en WAV sin tocar.
- **Todas las 57 carpetas**: ahorra ~1.4GB completo. Es lo normal — no hay razón para mantener las antiguas en WAV si las nuevas van a OGG.

**Cambios necesarios en código** (sencillos, ~5 líneas):

1. Convertir cada `*.wav` a `*.ogg` (mono, 128kbps) sobre las carpetas elegidas. Borrar los WAV.
2. En `src/audio/synth.js`, los arrays `*_FILES` y los nombres en el `urls` de cada `samplerPreset(...)` deben terminar en `.ogg` en vez de `.wav`. Se puede hacer con un `sed -i '' "s/\.wav'/\.ogg'/g"` sobre el archivo.
3. Verificar build y probar 1-2 instrumentos en el navegador.

**Carga bajo demanda ya existe.** `Tone.Sampler` solo descarga el archivo cuando se toca su nota MIDI por primera vez. O sea, abrir la app no cuesta 1.4GB; el primer instrumento seleccionado sí dispara la descarga. La compresión reduce el tráfico de red en el deploy a producción y el tamaño del repo en disco.

**Tiempo de conversión estimado.** 1041 archivos en M1 con `ffmpeg -threads 8`: ~20-40s. Con `afconvert` (nativo macOS): 3-5 min.

**Test previo sin comprometerse** (5 segundos):

```bash
mkdir -p /tmp/ogg_test
for f in public/samples/AbstractVoice/*.wav; do
  ffmpeg -i "$f" -c:a libvorbis -ac 1 -b:a 128k \
    "/tmp/ogg_test/$(basename "${f%.wav}").ogg" -y 2>/dev/null
done
du -sh public/samples/AbstractVoice/ /tmp/ogg_test/
# ratio = (1.4GB / du_abstract_voice) * du_ogg_test → tamaño total estimado
```

---

## Otros

_(sección a rellenar con futuras mejoras)_
