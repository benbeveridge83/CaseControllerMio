import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mioV268Transform from './mio-v268-transform.js'
import mioV268Hotfix from './mio-v268-hotfix.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [mioV268Transform(), mioV268Hotfix(), react()],
})
