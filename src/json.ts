import type { Cfg } from "./cfg.ts";
import type { RenderError } from "./wasm.ts";

export function formatCfg(cfg: Cfg): string {
  return JSON.stringify(cfg, null, 2);
}

/**
 * Parse `text` into `target`, replacing its contents in place. Everything
 * else in the app holds a reference to that one object, so rebinding here
 * would silently strand the form and the preview on the old one.
 */
export function applyText(target: Cfg, text: string): RenderError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // V8 and JavaScriptCore word a JSON.parse failure differently -- JSC's
    // message carries no `position N` -- so this reports "not JSON yet"
    // without fabricating a position. Real positions still reach the UI from
    // the module's own errors, which serde_json produces reliably.
    return { kind: "schema", message: e instanceof Error ? e.message : String(e) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "schema", message: "a config must be a JSON object", line: 1, column: 1 };
  }
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, parsed);
  return null;
}

export type JsonPane = { sync(): void; hasFocus(): boolean };

export function createJsonPane(
  el: HTMLTextAreaElement,
  cfg: Cfg,
  onEdit: (e: RenderError | null) => void,
): JsonPane {
  // While the pane has focus it owns cfg and nothing serialises back into it.
  // Without that arbitration, writing on every keystroke fights the cursor.
  el.addEventListener("input", () => onEdit(applyText(cfg, el.value)));
  return {
    sync() {
      if (document.activeElement !== el) el.value = formatCfg(cfg);
    },
    hasFocus() {
      return document.activeElement === el;
    },
  };
}
