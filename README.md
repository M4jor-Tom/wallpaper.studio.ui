# bgsvg studio

A browser editor for `bgsvg` configs. Inputs edit a JSON config and the
rendered SVG updates live -- no more reading `parameters.proto` by hand and
running a binary to see what a change did.

## Running it

```bash
nix develop
bun install
bun run dev
```

`nix develop` provides the toolchain: **bun** (runtime, package manager and
TypeScript execution in one binary) and the `bgsvg` CLI used by the drift
check below. Everything else -- `bun run dev`, `bun test`, `bun run build` --
runs inside that shell.

## The three columns

| column | holds |
|---|---|
| **controls** | one hand-written widget per config field -- a stepper for the seed, a segmented control per enum, a picker for colour |
| **preview** | the rendered SVG, scaled to fit its pane at the selected output's aspect ratio |
| **JSON** | the config as text; it round-trips, so pasting a config moves the controls and vice versa |

The JSON is the artifact being produced, which is why it gets a column rather
than a drawer. Both dividers drag with persisted widths, and the JSON column
collapses to a labelled rail below 1100px, reopening as an overlay; below
768px the preview pins to the top with the form and JSON as tabs beneath it,
so the render stays visible at every width.

## The renderer module

Rendering comes from a WASM build of `bgsvg`, produced by the `svg_builder`
repository. `flake.nix` declares it as a flake input, so `flake.lock` pins
one exact revision -- the `.wasm`, its generated `.d.ts`, and the
`bgsvg --descriptor` output the drift check compares against all come from
that single revision, which is what makes the drift check meaningful.

Two commands follow from that:

- **`nix flake update svg_builder`** adopts a newer revision as a deliberate
  act, once it has been pushed upstream, and records which one in the
  lockfile.
- **`nix develop --override-input svg_builder path:../svg_builder`** builds
  against a local `svg_builder` working tree for co-development across both
  repositories, without touching the lock or requiring a commit there.

## Checks

```bash
bun test        # unit tests, after vendoring the module's .d.ts/.js/.wasm
bun run drift   # src/schema.ts vs the locked revision's bgsvg --descriptor
bun run build   # tsc --noEmit, then vite build
```
