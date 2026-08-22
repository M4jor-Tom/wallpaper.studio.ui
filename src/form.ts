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

/**
 * Everything interpolated into the markup string goes through this. Exported
 * so it has its own test -- the config is rebuilt from whatever JSON the pane
 * holds, including pasted text no earlier task had to treat as hostile.
 * `&` must be replaced first, or the entities the other replacements produce
 * (themselves starting with `&`) would be escaped a second time.
 */
export function esc(v: unknown): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The schema is the one place a field's default lives; read it, don't restate it. */
function defOf(path: string): unknown {
  return FIELDS.find((f) => f.path === path)?.def;
}

/**
 * A pasted config can put any JSON value at any path. These two coerce back
 * to the type a control needs, falling back to the schema default rather than
 * rendering garbage -- or, for the colour control's `.slice`, throwing.
 */
function strOf(v: unknown, def: string): string {
  return typeof v === "string" ? v : def;
}

function numOf(v: unknown, def: number): number {
  return typeof v === "number" ? v : def;
}

/**
 * Which branch of a oneof the config holds -- or, when it holds none, the
 * schema default, because that is what the renderer applies to an absent key.
 * The control and visible() must answer this the same question: `{}` renders
 * the hexatri radio checked, and anything that asked "is icon.hexatri present"
 * instead would hide the icon fields under a branch the user can see selected.
 */
function chosen(f: Field & { kind: "choice" }): string {
  return f.branches.find((b) => getPath(cfg, `${f.path}.${b}`) !== undefined) ?? f.def;
}

const ICON = FIELDS.find((f) => f.path === "icon") as Extract<Field, { kind: "choice" }>;

function radios(f: Field & { kind: "enum" | "choice" }, current: string): string {
  const values = f.kind === "enum" ? f.values : f.branches;
  const opts = values
    .map(
      (v) => `
      <input type="radio" id="${esc(id(f.path, v))}" name="${esc(id(f.path))}" value="${esc(v)}"
             data-path="${esc(f.path)}" data-kind="${esc(f.kind)}" ${v === current ? "checked" : ""}>
      <label for="${esc(id(f.path, v))}">${esc(v)}</label>`,
    )
    .join("");
  return `<fieldset class="seg" data-field="${esc(f.path)}">
    <legend>${esc(f.label)}</legend><div class="seg-track">${opts}</div>
  </fieldset>`;
}

function control(f: Field): string {
  switch (f.kind) {
    case "number": {
      const v = numOf(getPath(cfg, f.path), f.def);
      return `<div class="row" data-field="${esc(f.path)}">
        <label for="${esc(id(f.path))}">${esc(f.label)}</label>
        <input type="number" id="${esc(id(f.path))}" data-path="${esc(f.path)}" data-kind="number"
               min="${esc(f.min)}" max="${esc(f.max)}" step="${esc(f.step)}" value="${esc(v)}">
      </div>`;
    }
    case "enum":
      return radios(f, strOf(getPath(cfg, f.path), f.def));
    case "choice":
      return radios(f, chosen(f));
    case "toggle": {
      const on = getPath(cfg, f.path) !== undefined;
      return `<div class="row" data-field="${esc(f.path)}">
        <input type="checkbox" id="${esc(id(f.path))}" data-path="${esc(f.path)}" data-kind="toggle"
               ${on ? "checked" : ""}>
        <label for="${esc(id(f.path))}">${esc(f.label)}</label>
      </div>`;
    }
    case "color": {
      // getPath can hand back anything a pasted config puts here -- a number,
      // an object, an array. strOf falls back to the schema default so
      // `.slice` below always has a string to work with.
      const v = strOf(getPath(cfg, f.path), f.def);
      return `<div class="row" data-field="${esc(f.path)}">
        <label for="${esc(id(f.path))}">${esc(f.label)}</label>
        <input type="color" id="${esc(id(f.path))}" data-path="${esc(f.path)}" data-kind="color"
               value="${esc(v.slice(0, 7))}">
        <output for="${esc(id(f.path))}">${esc(v)}</output>
      </div>`;
    }
  }
}

/**
 * A field is shown only when the branch it belongs to is present -- an icon
 * motion means nothing on a ship, and a rain angle means nothing with no rain.
 */
function visible(f: Field): boolean {
  if (f.path.startsWith("icon.hexatri")) return chosen(ICON) === "hexatri";
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

  // Assignment, not addEventListener: pasted JSON now makes buildForm re-run
  // on the same root (rebuild()), and addEventListener would stack a new
  // listener on every paste, firing the handler that many times per keystroke.
  root.oninput = (ev) => {
    const el = ev.target as HTMLInputElement;
    const path = el.dataset.path;
    const kind = el.dataset.kind;
    if (!path || !kind) return;

    switch (kind) {
      case "number":
        // An emptied number input reports valueAsNumber NaN and still fires
        // `input`. Storing it serialises as `null`, which the module rejects --
        // and numOf would then read the schema default back out, so the form
        // would show 0 while cfg held null. Absent is what "no value" means.
        if (Number.isNaN(el.valueAsNumber)) clearPath(cfg, path);
        else setPath(cfg, path, el.valueAsNumber);
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
        if (el.checked) setPath(cfg, path, { angle: 0, color: defOf(`${path}.color`) });
        else clearPath(cfg, path);
        break;
      case "color": {
        // the picker gives #rrggbb; keep the alpha the config already carried
        const prev = strOf(getPath(cfg, path), defOf(path) as string);
        setPath(cfg, path, el.value + (prev.length === 9 ? prev.slice(7) : ""));
        break;
      }
    }
    syncForm();
    notify(kind === "enum" || kind === "choice" || kind === "toggle");
  };
}
