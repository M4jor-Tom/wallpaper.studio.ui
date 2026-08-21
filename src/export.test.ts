import { expect, test } from "bun:test";
import { parseResolutions, slug } from "./export.ts";

test("parseResolutions reads the module's preset table", () => {
  const list = parseResolutions('[{"name":"1080p","width":1920,"height":1080}]');
  expect(list).toEqual([{ name: "1080p", width: 1920, height: 1080 }]);
});

test("parseResolutions rejects a shape it does not recognise", () => {
  // this is the module's contract; a silent [] would give an empty dropdown
  expect(() => parseResolutions("{}")).toThrow();
  expect(() => parseResolutions('[{"name":"x"}]')).toThrow();
});

test("slug names a file the way the renderer names its own", () => {
  expect(slug({})).toBe("static-rotate-hexatri-none-none");
  expect(
    slug({
      background: { motion: "LIGHTS", image: "STARFIELD" },
      icon: { ship: {} },
      overlay: { matrix: { angle: 250 } },
    }),
  ).toBe("lights-static-ship-space-matrix");
});
