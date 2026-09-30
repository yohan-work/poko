/// <reference types="vite/client" />

import type { PokoApi } from "../../../electron/preload";

declare global {
  interface Window {
    poko: PokoApi;
  }
}
