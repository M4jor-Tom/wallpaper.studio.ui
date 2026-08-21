import { expect, test } from "bun:test";
import { applyText, formatCfg } from "./json.ts";

test("a config round-trips through the pane unchanged", () => {
  const cfg = { seed: 7, background: { motion: "LIGHTS", image: "STARFIELD" } };
  const target = {};
  expect(applyText(target, formatCfg(cfg))).toBeNull();
  expect(target).toEqual(cfg);
});

test("applyText replaces the object in place rather than rebinding it", () => {
  // main.ts holds one `cfg` reference and hands it to the form, the preview and
  // the pane. If the pane rebound it, the other two would keep the old object.
  const target: Record<string, unknown> = { seed: 1, background: { motion: "SCAN" } };
  applyText(target, '{"seed": 2}');
  expect(target).toEqual({ seed: 2 });
});

test("applyText reports malformed JSON with a message, not a fabricated position", () => {
  // bun runs JavaScriptCore, whose JSON.parse error carries no `position N` --
  // a regex built for V8's wording would never match here, so line would
  // silently stay 1 without the derivation ever being exercised. line/column
  // are optional on RenderError for exactly this: the pane's pre-parse check
  // only needs to say "not JSON yet".
  const e = applyText({}, "{ not json");
  expect(e).not.toBeNull();
  expect(e!.kind).toBe("schema");
  expect(e!.message.length).toBeGreaterThan(0);
  expect(e!.message.toLowerCase()).toMatch(/json|token|unexpected|expected/);
  expect(e!.line).toBeUndefined();
  expect(e!.column).toBeUndefined();
});

test("applyText rejects a non-object document", () => {
  expect(applyText({}, "[1,2]")!.message).toContain("object");
  expect(applyText({}, "42")!.message).toContain("object");
});
