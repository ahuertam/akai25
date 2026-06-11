import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` se usa para construir las URLs absolutas de los assets en producción.
// En GitHub Pages la app se sirve desde `https://<user>.github.io/akai25/`,
// por lo que el base path debe coincidir con el nombre del repositorio.
export default defineConfig({
  plugins: [react()],
  base: '/akai25/',
})
