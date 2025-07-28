import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import compression from 'vite-plugin-compression2'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      compression({
        algorithm: 'brotliCompress',
        exclude: [/\.(br)$/, /\.(gz)$/],
        deleteOriginalAssets: false,
      }),
    ],
    build: {
      outDir: 'dist',
      assetsInlineLimit: 4096,
      sourcemap: false,
      minify: 'esbuild',
    },
    esbuild: {
      drop: env.PROD ? ['console', 'debugger'] : [],
      pure: env.PROD ? ['console.log'] : [],
      treeShaking: true,
      legalComments: 'none',
    },
    server: {
      port: 8080,
      open: true,
    },
  }
})