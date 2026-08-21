import { defaults } from "./cfg.ts";
import { buildForm } from "./form.ts";
import { createPreview } from "./preview.ts";
import { ready } from "./wasm.ts";
import type { RenderError } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;
const banner = document.querySelector<HTMLParagraphElement>("#error")!;
const cfg = defaults();

function showError(e: RenderError | null): void {
  banner.hidden = e === null;
  banner.textContent = e ? e.message : "";
}

await ready();
const preview = createPreview(img, showError);
buildForm(document.querySelector<HTMLElement>("#controls")!, cfg, (immediate) =>
  preview.draw(cfg, immediate),
);
preview.draw(cfg, true);
