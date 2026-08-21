import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { parseDescriptor } from "./descriptor.ts";
import { DECLARED_ENUMS } from "../src/schema.ts";

const descriptor = () =>
  parseDescriptor(new Uint8Array(execFileSync("bgsvg", ["--descriptor"], { maxBuffer: 1 << 24 })));

// The parser is hand-rolled, so pin what it must find in a schema we know.
// If this drifts, the parser is wrong before the form is.
test("the descriptor parser finds the schema's enums", () => {
  const s = descriptor();
  expect(s.enums[".svg_builder.Background.Motion"]).toEqual([
    "STATIC",
    "SCAN",
    "LIGHTS",
    "CLOSEOPEN",
  ]);
  expect(s.enums[".svg_builder.Background.Image"]).toEqual(["NONE", "STARFIELD"]);
  expect(s.enums[".svg_builder.Hexatri.Motion"]).toEqual(["ROTATE", "STATIC"]);
  expect(s.messages).toContain(".svg_builder.Matrix");
});

// The check itself: every enum value the schema has must be offered by the form.
test("the form offers every enum value the schema has", () => {
  const s = descriptor();
  const missing: string[] = [];
  for (const [name, values] of Object.entries(s.enums)) {
    const declared = DECLARED_ENUMS[name];
    if (!declared) {
      missing.push(`${name}: not declared in schema.ts at all`);
      continue;
    }
    for (const v of values) {
      if (!declared.includes(v)) missing.push(`${name}.${v}: in the schema, not in the form`);
    }
  }
  expect(missing).toEqual([]);
});
