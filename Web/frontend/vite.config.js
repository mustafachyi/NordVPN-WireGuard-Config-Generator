import { fileURLToPath, URL } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    cloudflare({
      configPath: fileURLToPath(new URL('../worker/wrangler.jsonc', import.meta.url)),
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    legalComments: 'none',
  },
  build: {
    reportCompressedSize: false,
    sourcemap: false,
  },
  server: {
    cors: false,
    port: 8080,
    open: true,
  },
})