// The one place the module is loaded. `--target web` needs an explicit async
// init before any export is callable, and the .wasm is fetched by URL rather
// than inlined, so vite must be told to emit it as an asset.
import init, { render, resolutions, resolve_resolution } from "@bgsvg/bgsvg_wasm.js";
import wasmUrl from "@bgsvg/bgsvg_wasm_bg.wasm?url";

/**
 * What the module throws. It crosses the boundary as an untyped JsValue, so
 * this declaration is an assertion about a contract owned by svg_builder --
 * `tools/`'s and Task 4's tests check it against the real module rather than
 * trusting these lines.
 */
export type RenderError = {
  kind: "schema" | "invalid";
  message: string;
  line?: number;
  column?: number;
};

export function isRenderError(e: unknown): e is RenderError {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Partial<RenderError>;
  if (r.kind !== "schema" && r.kind !== "invalid") return false;
  if (typeof r.message !== "string") return false;
  // line/column are optional, but if present they must be numbers -- the JSON
  // pane indexes into text with them
  if (r.line !== undefined && typeof r.line !== "number") return false;
  if (r.column !== undefined && typeof r.column !== "number") return false;
  return true;
}

let started: Promise<void> | undefined;

/** Idempotent: every caller awaits the same instantiation. */
export function ready(): Promise<void> {
  started ??= init({ module_or_path: wasmUrl }).then(() => undefined);
  return started;
}

// `start()` is exported by the module but wasm-bindgen calls it during init --
// calling it again is not useful.
export { render, resolutions, resolve_resolution };
