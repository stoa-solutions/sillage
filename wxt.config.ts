import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Playlist Recall',
    description: 'Retrouvez vos vidéos YouTube par souvenir. Recherche privée et locale.',
    permissions: ['sidePanel', 'unlimitedStorage'],
    action: { default_title: 'Ouvrir Playlist Recall' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' https://i.ytimg.com data:;",
    },
  },
  vite: () => ({ worker: { format: 'es' }, build: { chunkSizeWarningLimit: 2000 } }),
});
