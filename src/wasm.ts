// The one place the module is loaded. `--target web` needs an explicit async
// init before any export is callable, and the .wasm is fetched by URL rather
// than inlined, so vite must be told to emit it as an asset.
import init, { render, resolutions, resolve_resolution } from "@bgsvg/bgsvg_wasm.js";
import wasmUrl from "@bgsvg/bgsvg_wasm_bg.wasm?url";

/// What the module throws. It crosses the boundary as an untyped JsValue, so
/// this declaration is an assertion about a contract owned by svg_builder --
/// `tools/`'s and Task 4's tests check it against the real module rather than
/// trusting these lines.
export type RenderError = {
  kind: "schema" | "invalid";
  message: string;
  line?: number;
  column?: number;
};

export function isRenderError(e: unknown): e is RenderError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    ((e as RenderError).kind === "schema" || (e as RenderError).kind === "invalid")
  );
}

let started: Promise<void> | undefined;

/// Idempotent: every caller awaits the same instantiation.
export function ready(): Promise<void> {
  started ??= init({ module_or_path: wasmUrl }).then(() => undefined);
  return started;
}

// `start()` is exported by the module but wasm-bindgen calls it during init --
// calling it again is not useful.
export { render, resolutions, resolve_resolution };
