import { clearPath, getPath, setPath, type Cfg } from "./cfg.ts";
import { FIELDS, type Field } from "./schema.ts";

// Segmented controls are real radios in a fieldset with a legend: keyboard
// navigation and screen-reader semantics come from the elements rather than
// from reconstructed ARIA.

let cfg: Cfg;
let notify: (immediate: boolean) => void;

function id(path: string, value?: string): string {
  return `f-${path.replace(/\./g, "-")}${value ? `-${value}` : ""}`;
}

function radios(f: Field & { kind: "enum" | "choice" }, current: string): string {
  const values = f.kind === "enum" ? f.values : f.branches;
  const opts = values
    .map(
      (v) => `
      <input type="radio" id="${id(f.path, v)}" name="${id(f.path)}" value="${v}"
             data-path="${f.path}" data-kind="${f.kind}" ${v === current ? "checked" : ""}>
      <label for="${id(f.path, v)}">${v}</label>`,
    )
    .join("");
  return `<fieldset class="seg" data-field="${f.path}">
    <legend>${f.label}</legend><div class="seg-track">${opts}</div>
  </fieldset>`;
}

function control(f: Field): string {
  switch (f.kind) {
    case "number": {
      const v = (getPath(cfg, f.path) as number | undefined) ?? f.def;
      return `<div class="row" data-field="${f.path}">
        <label for="${id(f.path)}">${f.label}</label>
        <input type="number" id="${id(f.path)}" data-path="${f.path}" data-kind="number"
               min="${f.min}" max="${f.max}" step="${f.step}" value="${v}">
      </div>`;
    }
    case "enum":
      return radios(f, (getPath(cfg, f.path) as string | undefined) ?? f.def);
    case "choice": {
      const present = f.branches.find((b) => getPath(cfg, `${f.path}.${b}`) !== undefined);
      return radios(f, present ?? f.def);
    }
    case "toggle": {
      const on = getPath(cfg, f.path) !== undefined;
      return `<div class="row" data-field="${f.path}">
        <input type="checkbox" id="${id(f.path)}" data-path="${f.path}" data-kind="toggle"
               ${on ? "checked" : ""}>
        <label for="${id(f.path)}">${f.label}</label>
      </div>`;
    }
    case "color": {
      const v = (getPath(cfg, f.path) as string | undefined) ?? f.def;
      return `<div class="row" data-field="${f.path}">
        <label for="${id(f.path)}">${f.label}</label>
        <input type="color" id="${id(f.path)}" data-path="${f.path}" data-kind="color"
               value="${v.slice(0, 7)}">
        <output for="${id(f.path)}">${v}</output>
      </div>`;
    }
  }
}

/**
 * A field is shown only when the branch it belongs to is present -- an icon
 * motion means nothing on a ship, and a rain angle means nothing with no rain.
 */
function visible(f: Field): boolean {
  if (f.path.startsWith("icon.hexatri")) return getPath(cfg, "icon.hexatri") !== undefined;
  if (f.path.startsWith("overlay.matrix.")) return getPath(cfg, "overlay.matrix") !== undefined;
  return true;
}

export function syncForm(): void {
  for (const f of FIELDS) {
    const el = document.querySelector<HTMLElement>(`[data-field="${f.path}"]`);
    if (el) el.hidden = !visible(f);
  }
}

export function buildForm(
  root: HTMLElement,
  state: Cfg,
  onChange: (immediate: boolean) => void,
): void {
  cfg = state;
  notify = onChange;
  root.innerHTML = FIELDS.map(control).join("");
  syncForm();

  root.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    const path = el.dataset.path;
    const kind = el.dataset.kind;
    if (!path || !kind) return;

    switch (kind) {
      case "number":
        setPath(cfg, path, el.valueAsNumber);
        break;
      case "enum":
        setPath(cfg, path, el.value);
        break;
      case "choice": {
        // a oneof: the chosen branch replaces whatever was there
        const f = FIELDS.find((x) => x.path === path) as Extract<Field, { kind: "choice" }>;
        for (const b of f.branches) clearPath(cfg, `${path}.${b}`);
        setPath(cfg, `${path}.${el.value}`, el.value === "hexatri" ? { motion: "ROTATE" } : {});
        break;
      }
      case "toggle":
        if (el.checked) setPath(cfg, path, { angle: 0, color: "#395e53b3" });
        else clearPath(cfg, path);
        break;
      case "color": {
        // the picker gives #rrggbb; keep the alpha the config already carried
        const prev = (getPath(cfg, path) as string | undefined) ?? "#395e53b3";
        setPath(cfg, path, el.value + (prev.length === 9 ? prev.slice(7) : ""));
        break;
      }
    }
    syncForm();
    notify(kind === "enum" || kind === "choice" || kind === "toggle");
  });
}
