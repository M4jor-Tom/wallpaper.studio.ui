import { ready, render } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;

let url: string | undefined;
function show(svg: string): void {
  const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  // revoking is not hygiene -- it is the difference between steady memory and
  // leaking a blob per render once this loop runs on every keystroke
  if (url) URL.revokeObjectURL(url);
  img.src = next;
  url = next;
}

await ready();
show(render("{}", 640, 360));
img.alt = "static-rotate-hexatri-none-none";
