import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The service worker precaches the app shell (HTML, JS, CSS, icons) so the
    // app opens with no network. It does not touch data: Firestore's own
    // IndexedDB cache handles that.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Appeltaart',
        short_name: 'Appeltaart',
        description: 'Shared family shopping list that works offline',
        lang: 'en',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2e7d32',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Firebase Auth's sign-in helper pages must always come from the network.
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
})
