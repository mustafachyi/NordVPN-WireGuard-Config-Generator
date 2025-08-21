import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import compression from 'vite-plugin-compression2'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    cssInjectedByJsPlugin(),
    compression({
      algorithms: ['brotliCompress'],
      exclude: [/\.(br)$/],
      deleteOriginalAssets: false,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        pure_funcs: ['console.log'],
      },
      format: {
        comments: false,
      },
    },
  },
  esbuild: {
    treeShaking: true,
    legalComments: 'none',
  },
  server: {
    port: 8080,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})