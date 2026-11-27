import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

// @crxjs/vite-plugin 把 manifest、content script、background service worker
// 和 popup(React 页面) 打成可直接「加载已解压扩展」的 dist 目录。
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
