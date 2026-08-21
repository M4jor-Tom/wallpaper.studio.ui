import { expect, test } from "bun:test";
import { fitTo } from "./preview.ts";

test("fitTo keeps the output aspect ratio inside the pane", () => {
  // Composition is resolution-independent -- scaling w and h by one factor
  // leaves the cell count unchanged -- so a fitted preview is a true scale
  // model, not an approximation.
  expect(fitTo(1920, 1080, 800, 800)).toEqual({ width: 800, height: 450 });
  expect(fitTo(1080, 1920, 800, 800)).toEqual({ width: 450, height: 800 });
  expect(fitTo(1920, 1080, 400, 100)).toEqual({ width: 178, height: 100 });
});

test("fitTo never returns a zero dimension", () => {
  // the module rejects a zero dimension; the preview must not produce one
  const r = fitTo(1920, 1080, 3, 3);
  expect(r.width).toBeGreaterThan(0);
  expect(r.height).toBeGreaterThan(0);
});
