// Fails when parameters.proto holds an enum value src/schema.ts does not offer.
// Nothing upstream catches this: `valid_configs` enumerates the Rust enums, so
// a new Background.Motion variant grows both of svg_builder's test surfaces and
// still never reaches these controls.
import { execFileSync } from "node:child_process";
import { parseDescriptor } from "./descriptor.ts";
import { DECLARED_ENUMS } from "../src/schema.ts";

type Enums = Readonly<Record<string, readonly string[]>>;

/**
 * The whole comparison, in one place because drift.test.ts asserts on exactly
 * what the tool reports. Two copies of it -- the tool's and the test's -- could
 * agree on the forward direction and silently disagree about the rest.
 */
export function compare(declared: Enums, found: Enums): string[] {
  // Zero enums parsed is indistinguishable from zero drift, so refuse to
  // report success on a descriptor we plainly failed to read. This returns
  // rather than continues: every enum would then also look "declared but
  // absent upstream", which is noise about a descriptor we never read.
  if (Object.keys(found).length < Object.keys(declared).length) {
    return [
      `parsed ${Object.keys(found).length} enums but the form declares ` +
      `${Object.keys(declared).length} -- the descriptor was unreadable, not clean`,
    ];
  }

  const problems: string[] = [];
  for (const [name, values] of Object.entries(found)) {
    const want = declared[name];
    if (!want) {
      problems.push(`${name}: the schema has this enum; src/schema.ts does not declare it`);
      continue;
    }
    for (const v of values) {
      if (!want.includes(v)) {
        problems.push(`${name}.${v}: in parameters.proto, not offered by the form`);
      }
    }
    // the reverse direction: a value the form offers that upstream removed
    // would otherwise render a control the renderer rejects
    for (const d of want) {
      if (!values.includes(d)) {
        problems.push(`${name}.${d}: offered by the form, not in parameters.proto`);
      }
    }
  }
  return problems;
}

function main(): void {
  const schema = parseDescriptor(
    new Uint8Array(execFileSync("bgsvg", ["--descriptor"], { maxBuffer: 1 << 24 })),
  );
  const problems = compare(DECLARED_ENUMS, schema.enums);
  if (problems.length > 0) {
    console.error(`drift: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("\nadd the value to src/schema.ts's FIELDS (and ENUM_PROTO_NAMES if this is a new enum)");
    process.exit(1);
  }
  console.log(`drift ok: ${Object.keys(schema.enums).length} enums, every value offered`);
}

// so drift.test.ts can import compare() without running the tool
if (import.meta.main) main();
