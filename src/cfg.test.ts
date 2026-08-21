import { expect, test } from "bun:test";
import { clearPath, defaults, getPath, setPath, type Cfg } from "./cfg.ts";

test("an empty config is the default config", () => {
  // {} is a complete config -- every proto3 zero is the renderer's default --
  // so the editor starts from {} rather than spelling the defaults out.
  expect(defaults()).toEqual({});
});

test("setPath creates intermediate objects", () => {
  const c = {};
  setPath(c, "background.motion", "LIGHTS");
  expect(c).toEqual({ background: { motion: "LIGHTS" } });
});

test("getPath returns undefined for an absent branch", () => {
  expect(getPath({}, "overlay.matrix.angle")).toBeUndefined();
  expect(getPath({ overlay: { matrix: { angle: 250 } } }, "overlay.matrix.angle")).toBe(250);
});

test("clearPath removes a branch and prunes the empty parent", () => {
  // typed as Cfg, not inferred as a literal shape -- clearPath mutates the
  // object's keys, and toEqual's expected type must not pin them in place
  const c: Cfg = { overlay: { matrix: { angle: 250 } } };
  clearPath(c, "overlay.matrix");
  // an empty `overlay` would serialise as `"overlay": {}`, which is a different
  // config from one with no overlay at all
  expect(c).toEqual({});
});

test("clearPath keeps a parent that still has other keys", () => {
  const c: Cfg = { background: { motion: "SCAN", image: "STARFIELD" } };
  clearPath(c, "background.image");
  expect(c).toEqual({ background: { motion: "SCAN" } });
});
