import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import compression from 'vite-plugin-compression2'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Brotli compression with maximum compression
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      compressionOptions: { level: 11 },
      threshold: 512,
      deleteOriginalAssets: false // Keep original files
    })
  ],
  build: {
    outDir: 'dist',
    // Ensure assets are optimized
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue']
        }
      }
    }
  },
  css: {
    modules: {
      generateScopedName: '[hash:base64:4]',
    },
    postcss: './postcss.config.js',
    devSourcemap: false,
    extract: false,
    inline: true,
  },
  optimizeDeps: {
    include: ['vue'],
    exclude: [],
  },
  esbuild: {
    drop: ['console', 'debugger'],
    pure: ['console.log', 'console.info', 'console.debug', 'console.trace'],
    treeShaking: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: 'none',
    charset: 'utf8',
    target: 'esnext',
  },
})
