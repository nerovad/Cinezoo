/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  /** Full URL of the self-hosted Umami tracker script, e.g. https://stats.cinezoo.tv/script.js */
  readonly VITE_UMAMI_SCRIPT_URL?: string;
  /** Website UUID that Umami issues when you add cinezoo.tv in its dashboard */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
