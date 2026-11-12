import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'esnext', rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), factory: resolve(import.meta.dirname, 'factory.html'), bricks: resolve(import.meta.dirname, 'bricks.html') } } },
})
