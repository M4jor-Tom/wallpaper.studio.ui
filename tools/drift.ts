// Fails when parameters.proto holds an enum value src/schema.ts does not offer.
// Nothing upstream catches this: `valid_configs` enumerates the Rust enums, so
// a new Background.Motion variant grows both of svg_builder's test surfaces and
// still never reaches these controls.
import { execFileSync } from "node:child_process";
import { parseDescriptor } from "./descriptor.ts";
import { DECLARED_ENUMS } from "../src/schema.ts";

const schema = parseDescriptor(
  new Uint8Array(execFileSync("bgsvg", ["--descriptor"], { maxBuffer: 1 << 24 })),
);

const problems: string[] = [];
for (const [name, values] of Object.entries(schema.enums)) {
  const declared = DECLARED_ENUMS[name];
  if (!declared) {
    problems.push(`${name}: the schema has this enum; src/schema.ts does not declare it`);
    continue;
  }
  for (const v of values) {
    if (!declared.includes(v)) {
      problems.push(`${name}.${v}: in parameters.proto, not offered by the form`);
    }
  }
}

if (problems.length > 0) {
  console.error(`drift: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nadd the value to src/schema.ts's FIELDS and DECLARED_ENUMS");
  process.exit(1);
}
console.log(`drift ok: ${Object.keys(schema.enums).length} enums, every value offered`);
