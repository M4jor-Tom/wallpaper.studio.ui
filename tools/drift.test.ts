import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { parseDescriptor } from "./descriptor.ts";
import { compare } from "./drift.ts";
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

// The check itself, through the function the tool runs -- not a second copy of
// it that could pass while `bun run drift` fails.
test("the form and the real schema do not drift", () => {
  expect(compare(DECLARED_ENUMS, descriptor().enums)).toEqual([]);
});

test("compare reports a value the schema has that the form does not offer", () => {
  expect(compare({ E: ["A"], F: ["Z"] }, { E: ["A", "B"], F: ["Z"] })).toEqual([
    "E.B: in parameters.proto, not offered by the form",
  ]);
});

// The direction the tool alone used to check: a control the renderer would
// reject, because upstream dropped the value the form still offers.
test("compare reports a value the form offers that the schema does not have", () => {
  expect(compare({ E: ["A", "B"], F: ["Z"] }, { E: ["A"], F: ["Z"] })).toEqual([
    "E.B: offered by the form, not in parameters.proto",
  ]);
});

test("compare reports an enum the schema has that schema.ts never declares", () => {
  expect(compare({ E: ["A"] }, { E: ["A"], G: ["Q"] })).toEqual([
    "G: the schema has this enum; src/schema.ts does not declare it",
  ]);
});

// The floor. An unreadable descriptor parses to few or no enums, which looks
// exactly like a clean run -- so it must not be reported as one.
test("compare refuses to call an unreadable descriptor clean", () => {
  const problems = compare({ E: ["A"], F: ["Z"] }, {});
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("unreadable");
  expect(problems[0]).toContain("parsed 0 enums but the form declares 2");
});

test("the floor tolerates a schema with more enums than the form declares", () => {
  // more upstream enums than the form maps is normal -- only fewer is suspect
  expect(compare({ E: ["A"] }, { E: ["A"], G: ["Q"], H: ["R"] })).toEqual([
    "G: the schema has this enum; src/schema.ts does not declare it",
    "H: the schema has this enum; src/schema.ts does not declare it",
  ]);
});
