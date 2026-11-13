import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Emits dist/sw.js from sw.template.js with the list of built files to
// precache. The cache name is derived from the files' contents, so every
// build that changes anything produces a new service worker and evicts the
// previous build's cache.
function serviceWorker(): Plugin {
  let outDir = "";
  return {
    name: "webtermux-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = (fs.readdirSync(outDir, { recursive: true }) as string[])
        .map((f) => f.split(path.sep).join("/"))
        .filter((f) => f !== "sw.js" && fs.statSync(path.join(outDir, f)).isFile())
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
      const template = fs.readFileSync(path.resolve(__dirname, "sw.template.js"), "utf8");
      fs.writeFileSync(
        path.join(outDir, "sw.js"),
        template
          .replace("__BUILD_ID__", hash.digest("hex").slice(0, 12))
          .replace("__PRECACHE__", JSON.stringify(files.map((f) => `/${f}`))),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
