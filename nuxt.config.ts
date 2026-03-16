import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import pkg from './package.json'

// Workaround for Nuxt 3.21 #app-manifest resolution error.
// The import("#app-manifest") in manifest.js is dead code (behind import.meta.server
// which is always false with ssr:false), but vite:import-analysis still tries to
// resolve it. Using enforce:'pre' transform strips it before analysis runs.
function appManifestShim(): Plugin {
  return {
    name: 'app-manifest-shim',
    enforce: 'pre',
    resolveId(id) {
      if (id === '#app-manifest') {
        return '\0virtual:app-manifest'
      }
    },
    load(id) {
      if (id === '\0virtual:app-manifest') {
        return 'export default {}'
      }
    },
    transform(code, id) {
      if (id.includes('composables/manifest') && code.includes('import("#app-manifest")')) {
        return code.replace(
          'import("#app-manifest")',
          'Promise.resolve({ default: {} })',
        )
      }
    },
  }
}

export default defineNuxtConfig({
  ssr: false,

  devtools: { enabled: false },

  runtimeConfig: {
    public: {
      appVersion: pkg.version,
    },
  },

  srcDir: 'app',

  modules: [
    '@pinia/nuxt',
    '@vueuse/nuxt',
  ],

  css: [
    '~/assets/css/main.css',
  ],

  imports: {
    dirs: [
      '../composables',
      '../shared',
    ],
  },

  vite: {
    plugins: [
      tailwindcss(),
      appManifestShim(),
    ],
    optimizeDeps: {
      include: ['monaco-editor'],
    },
  },

  devServer: {
    port: 1420,
  },

  compatibilityDate: '2025-01-01',
})
