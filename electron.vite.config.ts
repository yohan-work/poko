import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(rootDirectory, "electron/main.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(rootDirectory, "electron/preload.ts"),
      },
    },
  },
  renderer: {
    root: resolve(rootDirectory, "src/renderer"),
    plugins: [react()],
  },
});
