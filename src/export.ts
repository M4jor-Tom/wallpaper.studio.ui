import type { Cfg } from "./cfg.ts";
import { getPath } from "./cfg.ts";
import { render, resolutions, resolve_resolution } from "./wasm.ts";

export type Preset = { name: string; width: number; height: number };

export function parseResolutions(json: string): Preset[] {
  const v: unknown = JSON.parse(json);
  if (!Array.isArray(v)) throw new Error("resolutions() did not return an array");
  return v.map((p) => {
    if (
      typeof p !== "object" || p === null ||
      typeof (p as Preset).name !== "string" ||
      typeof (p as Preset).width !== "number" ||
      typeof (p as Preset).height !== "number"
    ) {
      throw new Error(`resolutions() entry is not {name,width,height}: ${JSON.stringify(p)}`);
    }
    return p as Preset;
  });
}

/**
 * The renderer's own vocabulary for naming a file, mirrored so a download
 * lands beside CLI output with a matching name.
 */
export function slug(cfg: Cfg): string {
  const motion = String(getPath(cfg, "background.motion") ?? "STATIC").toLowerCase();
  const image = getPath(cfg, "background.image") === "STARFIELD" ? "space" : "none";
  const ship = getPath(cfg, "icon.ship") !== undefined;
  const icon = ship ? "ship" : "hexatri";
  const fg = ship ? "static" : String(getPath(cfg, "icon.hexatri.motion") ?? "ROTATE").toLowerCase();
  const overlay = getPath(cfg, "overlay.matrix") !== undefined ? "matrix" : "none";
  return `${motion}-${fg}-${icon}-${image}-${overlay}`;
}

function download(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking in the same tick as the click is safe in Chromium and has
  // historically cancelled the download elsewhere; one turn of the event loop
  // is all the fetch needs to have started.
  setTimeout(() => URL.revokeObjectURL(url));
}

/** The module throws an untyped JsValue; every failure path here wants its message. */
function msg(e: unknown): string {
  return e instanceof Object && "message" in e ? String(e.message) : String(e);
}

export function initExport(
  select: HTMLSelectElement,
  custom: HTMLInputElement,
  svgBtn: HTMLButtonElement,
  jsonBtn: HTMLButtonElement,
  copyBtn: HTMLButtonElement,
  cfg: Cfg,
  onSize: (w: number, h: number) => void,
  onError: (message: string | null) => void,
): void {
  // new Option rather than interpolated markup: the names are Rust constants
  // today, but building DOM out of strings is the one habit the rest of this
  // repository routes through esc(), and a node needs no escaping at all.
  select.append(...parseResolutions(resolutions()).map((p) => new Option(p.name, p.name)));

  /**
   * Resolution parsing is the module's, never re-derived here -- including its
   * edge cases: empty means 1080p, whitespace is rejected, zero is rejected.
   */
  function size(): { width: number; height: number } | null {
    // A strict emptiness check, not `.trim() ||`: collapsing whitespace here
    // would fall back to the preset instead of letting resolve_resolution
    // reject it, silently hiding the edge case the comment above promises.
    const spec = custom.value === "" ? select.value : custom.value;
    try {
      const [w, h] = resolve_resolution(spec);
      onError(null);
      return { width: w!, height: h! };
    } catch (e) {
      onError(msg(e));
      return null;
    }
  }

  function update(): void {
    const s = size();
    if (s) onSize(s.width, s.height);
  }
  select.addEventListener("change", update);
  custom.addEventListener("input", update);

  svgBtn.addEventListener("click", () => {
    const s = size();
    if (!s) return;
    let svg: string;
    try {
      svg = render(JSON.stringify(cfg), s.width, s.height);
    } catch (e) {
      // CLOSEOPEN + NONE is reachable from the controls and the module rejects
      // it. The preview already routes that to the banner; without this the
      // export threw into the console and looked like a dead button.
      onError(msg(e));
      return;
    }
    download(`trihex-${slug(cfg)}-${s.width}x${s.height}.svg`, svg, "image/svg+xml");
  });

  jsonBtn.addEventListener("click", () => {
    download(`${slug(cfg)}.json`, JSON.stringify(cfg, null, 2), "application/json");
  });

  copyBtn.addEventListener("click", () => {
    const label = copyBtn.textContent;
    navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).then(
      () => {
        // aria-live on the button announces the swap; nothing else moves, so
        // the confirmation has to be on the thing that was pressed.
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = label;
        }, 1200);
      },
      // an insecure origin or a denied permission rejects, and silence there
      // is indistinguishable from success
      (e: unknown) => onError(msg(e)),
    );
  });

  update();
}
