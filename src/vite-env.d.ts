/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Relais du multijoueur en ligne (wss://…), fixé au build par l'hébergeur du jeu. */
  readonly VITE_NET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
