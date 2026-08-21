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

// Zero enums parsed is indistinguishable from zero drift, so refuse to report
// success on a descriptor we plainly failed to read.
const found = Object.keys(schema.enums).length;
const want = Object.keys(DECLARED_ENUMS).length;
if (found < want) {
  console.error(
    `drift: parsed ${found} enums but the form declares ${want} -- the descriptor was unreadable, not clean`,
  );
  process.exit(1);
}

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
  for (const d of declared) {
    if (!values.includes(d)) {
      problems.push(`${name}.${d}: offered by the form, not in parameters.proto`);
    }
  }
}

if (problems.length > 0) {
  console.error(`drift: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nadd the value to src/schema.ts's FIELDS (and ENUM_PROTO_NAMES if this is a new enum)");
  process.exit(1);
}
console.log(`drift ok: ${Object.keys(schema.enums).length} enums, every value offered`);
