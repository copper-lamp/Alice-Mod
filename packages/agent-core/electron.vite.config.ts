import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: path.resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
