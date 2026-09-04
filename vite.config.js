import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mioV268Transform from './mio-v268-transform.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [mioV268Transform(), react()],
})
