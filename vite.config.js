import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 把图表库与表格库切独立 chunk，避免主 bundle 膨胀
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('lightweight-charts')) return 'vendor-charts-lw'
          if (id.includes('/vue/') || id.includes('@vue/') || id.includes('/pinia/')) return 'vendor-vue'
        },
      },
    },
    // 单 chunk 提升到 800KB，避免无用警告
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupLocalStorage.js'],
    include: ['src/**/*.{test,spec}.{js,mjs}'],
    exclude: ['node_modules', 'dist'],
  },
})
