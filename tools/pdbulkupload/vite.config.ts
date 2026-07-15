import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/pdbulkupload/',
  build: {
    outDir: '../../src/InternalHostedFrontendTools.Api/wwwroot/pdbulkupload',
    emptyOutDir: true,
  },
})
