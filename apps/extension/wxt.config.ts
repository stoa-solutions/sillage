import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Playlist Recall",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    description:
      "Retrouvez vos vidéos YouTube par souvenir, texte ou miniature. Bibliothèque locale et serveur personnel.",
    permissions: ["sidePanel", "unlimitedStorage", "storage"],
    host_permissions: ["https://recall.stoa.solutions/*"],
    action: { default_title: "Ouvrir Playlist Recall" },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://recall.stoa.solutions http://127.0.0.1:3001; img-src 'self' https://i.ytimg.com https://i9.ytimg.com data:;",
    },
  },
  vite: () => ({
    worker: { format: "es" },
    build: { chunkSizeWarningLimit: 2000 },
  }),
});
