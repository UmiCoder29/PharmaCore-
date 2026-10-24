import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // ensuring paths are relative for Electron production builds
  server: {
    port: 5173,
    strictPort: true,
  }
})
