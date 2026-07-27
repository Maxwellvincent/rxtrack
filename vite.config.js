/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
// Dev-only: receives captured fixtures from the SP1 T4.1 schedule probe.
import { fixtureSink } from './vite-plugin-fixture-sink.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), fixtureSink()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    // .jsx too: hook tests render with react-dom into the jsdom from testEnv.js.
    include: ['src/**/*.test.{js,jsx}'],
  },
})
