import type { RenderError } from "./wasm.ts";

/** How much of the offending line to quote around the column. */
const WINDOW = 60;

/**
 * The banner is plain text, so the offending line is quoted under the message
 * with a caret at the column -- the same thing an underline says, in the one
 * place the error is already being read.
 *
 * `source` must be the text the position came from. The module parses
 * `JSON.stringify(cfg)`, so its serde_json line/column index into that
 * serialisation and not into an indented copy of it; quoting the wrong one
 * would point the caret at an unrelated character.
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
