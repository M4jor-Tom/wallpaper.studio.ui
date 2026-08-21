import { defaults } from "./cfg.ts";
import { buildForm } from "./form.ts";
import { ready, render } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;
const cfg = defaults();

let url: string | undefined;
function draw(): void {
  const svg = render(JSON.stringify(cfg), 640, 360);
  const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  // revoking is not hygiene -- it is the difference between steady memory and
  // leaking a blob per render once this loop runs on every keystroke
  if (url) URL.revokeObjectURL(url);
  img.src = next;
  url = next;
}

await ready();
buildForm(document.querySelector<HTMLElement>("#controls")!, cfg, draw);
draw();
