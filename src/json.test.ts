import { expect, test } from "bun:test";
import { getPath } from "./cfg.ts";
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

test("applyText strips a pasted __proto__ instead of repointing the target's prototype", () => {
  // Object.assign copies with [[Set]] semantics, and Object.prototype.__proto__
  // is an accessor -- assigning it would repoint cfg's real prototype at
  // attacker data rather than storing a "__proto__" key.
  const cfg: Record<string, unknown> = {};
  applyText(cfg, '{"__proto__":{"seed":999}}');
  expect(Object.getPrototypeOf(cfg)).toBe(Object.prototype);
  expect(getPath(cfg, "seed")).toBeUndefined();
});

test("a stripped __proto__ leaves every view of the config agreeing", () => {
  const cfg: Record<string, unknown> = {};
  applyText(cfg, '{"__proto__":{"seed":999,"background":{"motion":"LIGHTS"}}}');
  // own-property views (formatCfg, the preview's JSON.stringify) and
  // prototype-chain-walking views (the form's getPath) must not disagree
  expect(Object.keys(cfg)).toEqual([]);
  expect(formatCfg(cfg)).toBe("{}");
  expect(getPath(cfg, "background.motion")).toBeUndefined();
});

test("applyText does not over-strip a merely similarly-named key", () => {
  // "constructor" is a plain writable data property here, not an accessor --
  // Object.assign just shadows it like any other key. Stripping it too would
  // be its own bug.
  const cfg: Record<string, unknown> = {};
  applyText(cfg, '{"constructor":{"seed":999}}');
  expect(getPath(cfg, "constructor.seed")).toBe(999);
});
