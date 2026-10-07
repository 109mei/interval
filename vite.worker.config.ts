import { defineConfig } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
export default defineConfig({
  plugins: [
    {
      name: "interval-static-assets",
      resolveId(id) {
        if (id === "virtual:interval-assets") return "\0interval-assets";
      },
      load(id) {
        if (id !== "\0interval-assets") return;
        const assets: Record<string, { body: string; type: string }> = {};
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
        };
        function walk(dir: string, prefix = "") {
          for (const file of readdirSync(dir, { withFileTypes: true })) {
            if (file.isDirectory())
              walk(join(dir, file.name), `${prefix}/${file.name}`);
            else {
              const type = types[extname(file.name)];
              if (!type)
                throw new Error(`Unsupported asset type: ${file.name}`);
              assets[`${prefix}/${file.name}`] = {
                body: readFileSync(join(dir, file.name), "utf8"),
                type,
              };
            }
          }
        }
        walk("dist/client");
        return `export default ${JSON.stringify(assets)}`;
      },
    },
  ],
  build: {
    ssr: "src/server/worker.ts",
    outDir: "dist/server",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "index.js" } },
  },
});
