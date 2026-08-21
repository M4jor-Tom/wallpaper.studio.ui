import { defineConfig } from "vite";

// The module is a read-only Nix store path outside this project, so vite needs
// both an alias to import it and permission to serve files from there.
const pkg = process.env.BGSVG_WASM;
if (!pkg) {
  throw new Error("BGSVG_WASM is unset -- run inside `nix develop`");
}

export default defineConfig({
  resolve: { alias: { "@bgsvg": `${pkg}/web` } },
  server: { fs: { allow: [".", pkg] } },
  // src/main.ts uses top-level await, which vite's default build target predates.
  build: { target: "esnext" },
});
