import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` se usa para construir las URLs absolutas de los assets en producción.
// En GitHub Pages la app se sirve desde `https://<user>.github.io/akai25/`,
// por lo que el base path debe coincidir con el nombre del repositorio.
//
// `resolve.alias['~version'] → ./package.json` permite que la app importe
// la versión desde package.json sin hardcodearla en dos sitios (el
// subtítulo del header y el manifest de versionado). Vite resuelve el
// JSON y expone `default` con el objeto parseado.
export default defineConfig({
  plugins: [react()],
  base: '/akai25/',
  resolve: {
    alias: {
      '~version': new URL('./package.json', import.meta.url).pathname,
    },
  },
})