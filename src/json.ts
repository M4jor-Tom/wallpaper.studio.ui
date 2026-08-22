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
    // `__proto__` is stripped here rather than filtered at the merge: JSON.parse
    // defines it as an ordinary own property, but Object.assign copies with
    // [[Set]], which triggers Object.prototype's accessor and repoints the
    // target's real prototype. A reviver returning undefined deletes the key at
    // every depth, so nothing downstream has to know about the hazard.
    parsed = JSON.parse(text, (k, v) => (k === "__proto__" ? undefined : v));
  } catch (e) {
    // V8 and JavaScriptCore word a JSON.parse failure differently -- JSC's
    // message carries no `position N` -- so this reports "not JSON yet"
    // without fabricating a position. Real positions still reach the UI from
    // the module's own errors, which serde_json produces reliably.
    return { kind: "schema", message: e instanceof Error ? e.message : String(e) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    // No position: the whole document is wrong, and a fabricated line 1 column
    // 1 would make errorText quote a character that is not the problem.
    return { kind: "schema", message: "a config must be a JSON object" };
  }
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, parsed);
  return null;
}

/** How much of the offending line to quote around the column. */
const WINDOW = 60;

/**
 * A textarea cannot draw a decoration inside itself, so the offending line is
 * quoted under the message with a caret at the column -- the same thing an
 * underline says, in the one place the error is already being read.
 *
 * `source` must be the text the position came from. The module parses
 * `JSON.stringify(cfg)`, so its serde_json line/column index into that
 * serialisation and not into the pane's pretty-printed copy of it; quoting
 * the wrong one would point the caret at an unrelated character.
 */
export function errorText(e: RenderError, source: string): string {
  if (e.line === undefined) return e.message;
  const line = source.split("\n")[e.line - 1];
  if (line === undefined) return e.message;
  // A minified config is one long line, so quote a window around the column
  // rather than the whole of it -- a wrapped line puts the caret nowhere.
  const col = Math.min(Math.max(e.column ?? 1, 1), line.length + 1);
  const from = Math.max(0, col - 1 - WINDOW / 2);
  const head = from > 0 ? "..." : "";
  const tail = from + WINDOW < line.length ? "..." : "";
  return `${e.message}\n${head}${line.slice(from, from + WINDOW)}${tail}\n${
    " ".repeat(head.length + col - 1 - from)
  }^`;
}

export type JsonPane = { sync(): void };

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
  };
}
