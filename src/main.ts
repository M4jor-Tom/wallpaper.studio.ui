import { defaults } from "./cfg.ts";
import { buildForm } from "./form.ts";
import { createJsonPane } from "./json.ts";
import { createPreview } from "./preview.ts";
import { ready } from "./wasm.ts";
import type { RenderError } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;
const banner = document.querySelector<HTMLParagraphElement>("#error")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const cfg = defaults();

function showError(e: RenderError | null): void {
  banner.hidden = e === null;
  banner.textContent = e ? e.message : "";
}

await ready();
const preview = createPreview(img, showError);

/**
 * The form and the JSON pane both write into `cfg` and must tell each other:
 * a control edit re-serialises the text (pane.sync in the onChange below),
 * and text that parses re-renders the form (this function, called from the
 * pane's onEdit) so pasting a config moves the controls.
 */
function rebuild(): void {
  buildForm(controls, cfg, (immediate) => {
    pane.sync();
    preview.draw(cfg, immediate);
  });
}

const pane = createJsonPane(document.querySelector<HTMLTextAreaElement>("#json")!, cfg, (e) => {
  showError(e);
  if (e === null) {
    rebuild();
    preview.draw(cfg, false);
  }
});

rebuild();
pane.sync();
preview.draw(cfg, true);
