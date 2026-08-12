import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createApiHandler } from './server/api.mjs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'linear-api',
      configureServer(server) {
        server.middlewares.use(createApiHandler())
      },
    },
  ],
  server: { port: 5210 },
})
