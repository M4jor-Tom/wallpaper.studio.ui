import type { Cfg } from "./cfg.ts";
import { isRenderError, render, type RenderError } from "./wasm.ts";

/**
 * Fit an output aspect ratio inside a pane. Exact rather than approximate:
 * the renderer sizes everything from min(w,h)/9, so scaling both dimensions
 * by one factor leaves every RNG draw unchanged -- a 640x360 preview is a
 * true scale model of 1920x1080 from the same seed.
 */
export function fitTo(
  outW: number,
  outH: number,
  paneW: number,
  paneH: number,
): { width: number; height: number } {
  const k = Math.min(paneW / outW, paneH / outH);
  return {
    width: Math.max(1, Math.round(outW * k)),
    height: Math.max(1, Math.round(outH * k)),
  };
}

export type Preview = {
  draw(cfg: Cfg, immediate: boolean): void;
  setOutput(width: number, height: number): void;
};

export function createPreview(
  img: HTMLImageElement,
  onError: (e: RenderError | null) => void,
): Preview {
  let url: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let out = { width: 1920, height: 1080 };

  function paint(cfg: Cfg): void {
    let svg: string;
    try {
      const pane = img.parentElement!.getBoundingClientRect();
      const { width, height } = fitTo(out.width, out.height, pane.width, pane.height);
      svg = render(JSON.stringify(cfg), width, height);
    } catch (e) {
      // The preview never blanks: it holds the last valid render, so a
      // half-typed config in the JSON pane does not destroy what you were
      // looking at.
      onError(isRenderError(e) ? e : { kind: "invalid", message: String(e) });
      return;
    }
    onError(null);
    const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Revoking is not hygiene, it is the difference between steady memory and
    // leaking a 48-222 KB blob per keystroke.
    if (url) URL.revokeObjectURL(url);
    img.src = next;
    url = next;
  }

  return {
    draw(cfg, immediate) {
      if (timer) clearTimeout(timer);
      // What is debounced is the browser reparsing the document, not the
      // render, which is single-digit milliseconds.
      if (immediate) paint(cfg);
      else timer = setTimeout(() => paint(cfg), 100);
    },
    setOutput(width, height) {
      out = { width, height };
    },
  };
}
