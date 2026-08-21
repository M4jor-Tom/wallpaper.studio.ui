// What the form offers. This is the one place this repository restates
// something `parameters.proto` already says, which is why tools/drift.ts
// exists to fail CI when the two disagree.
//
// `path` is a dotted path into the config JSON. A `oneof` is a `choice`
// field: its value names which branch is present, and the branch object is
// created or removed when it changes.

export type Field =
  | { kind: "number"; path: string; label: string; min: number; max: number; step: number; def: number }
  | { kind: "enum"; path: string; label: string; values: readonly string[]; def: string }
  | { kind: "choice"; path: string; label: string; branches: readonly string[]; def: string }
  | { kind: "toggle"; path: string; label: string; def: boolean }
  | { kind: "color"; path: string; label: string; def: string };

export const FIELDS = [
  { kind: "number", path: "seed", label: "Seed", min: 0, max: 4294967295, step: 1, def: 0 },
  {
    kind: "enum",
    path: "background.motion",
    label: "Background motion",
    values: ["STATIC", "SCAN", "LIGHTS", "CLOSEOPEN"],
    def: "STATIC",
  },
  {
    kind: "enum",
    path: "background.image",
    label: "Background image",
    values: ["NONE", "STARFIELD"],
    def: "NONE",
  },
  { kind: "choice", path: "icon", label: "Icon", branches: ["hexatri", "ship"], def: "hexatri" },
  {
    kind: "enum",
    path: "icon.hexatri.motion",
    label: "Icon motion",
    values: ["ROTATE", "STATIC"],
    def: "ROTATE",
  },
  { kind: "toggle", path: "overlay.matrix", label: "Matrix rain", def: false },
  {
    kind: "number",
    path: "overlay.matrix.angle",
    label: "Rain angle",
    min: 0,
    max: 360,
    step: 1,
    def: 0,
  },
  { kind: "color", path: "overlay.matrix.color", label: "Rain colour", def: "#395e53b3" },
] as const satisfies readonly Field[];

/**
 * The proto enum each control corresponds to. Only the *names* live here --
 * the values come from FIELDS, so the list the form offers and the list the
 * drift check verifies cannot disagree.
 */
const ENUM_PROTO_NAMES: Readonly<Record<string, string>> = {
  "background.motion": ".svg_builder.Background.Motion",
  "background.image": ".svg_builder.Background.Image",
  "icon.hexatri.motion": ".svg_builder.Hexatri.Motion",
};

export const DECLARED_ENUMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  FIELDS.filter((f) => f.kind === "enum").map((f) => [ENUM_PROTO_NAMES[f.path] ?? `UNMAPPED:${f.path}`, f.values]),
);
