import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          tf: ['@tensorflow/tfjs', '@tensorflow/tfjs-backend-webgl'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/detect': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/fuse': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/ocr': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/stt': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/gesture': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/experiments': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
