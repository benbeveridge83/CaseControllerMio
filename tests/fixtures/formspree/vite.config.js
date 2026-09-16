import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
export default defineConfig({plugins:[react()],resolve:{alias:[{find:'./mioCloudRuntime.js',replacement:path.resolve('tests/fixtures/formspree/cloud.js')},{find:/^\.\/supabaseClient\.js$/,replacement:path.resolve('tests/fixtures/formspree/supabase.js')}]},server:{host:'127.0.0.1',port:4174}})
