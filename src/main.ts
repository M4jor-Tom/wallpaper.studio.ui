import { defaults } from "./cfg.ts";
import { initExport, slug } from "./export.ts";
import { buildForm } from "./form.ts";
import { errorText } from "./json.ts";
import { createPreview } from "./preview.ts";
import { initTheme } from "./theme.ts";
import { ready } from "./wasm.ts";
import type { RenderError } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;
const banner = document.querySelector<HTMLParagraphElement>("#error")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const resSelect = document.querySelector<HTMLSelectElement>("#res")!;
const resCustom = document.querySelector<HTMLInputElement>("#res-custom")!;
const dlSvg = document.querySelector<HTMLButtonElement>("#dl-svg")!;
const cfg = defaults();

function showError(e: RenderError | null): void {
  banner.hidden = e === null;
  // The module is handed JSON.stringify(cfg), so that is the text its
  // line/column point into.
  banner.textContent = e ? errorText(e, JSON.stringify(cfg)) : "";
}

initTheme(themeToggle);

try {
  await ready();
} catch (e) {
  // Without this the page is a header and nothing else: every line below
  // depends on the module, and the failure has no other place to surface.
  showError({
    kind: "invalid",
    message: `the renderer did not load: ${e instanceof Error ? e.message : String(e)}`,
  });
  throw e;
}

const preview = createPreview(img, showError);

/**
 * Every redraw keeps the img's alt in step with the config it depicts.
 * slug() is the renderer's own naming (mirrored in export.ts); this is the
 * one place it reaches the DOM rather than a copy re-derived per call site.
 */
function redraw(immediate: boolean): void {
  img.alt = slug(cfg);
  preview.draw(cfg, immediate);
}

// The resolution error and the render error share one banner: both are
// "why the preview isn't what you typed", and a second alert region would
// just be two places to look during a paste that fails for either reason.
//
// setOutput alone only records the target size -- it takes a redraw to put
// it on screen, which is why onSize is this wrapper and not setOutput itself.
initExport(
  resSelect,
  resCustom,
  dlSvg,
  cfg,
  (w, h) => {
    // Not immediate: `input` on the custom-size field fires per keystroke, and
    // 1920x1, 1920x10, 1920x108 are each a full synchronous render otherwise.
    preview.setOutput(w, h);
    redraw(false);
  },
  (message) => {
    showError(message === null ? null : { kind: "invalid", message });
  },
);

buildForm(controls, cfg, redraw);
redraw(true);
