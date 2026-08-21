import { ready, render } from "./wasm.ts";

const img = document.querySelector<HTMLImageElement>("#preview")!;

await ready();
const svg = render("{}", 640, 360);
img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
img.alt = "static-rotate-hexatri-none-none";
