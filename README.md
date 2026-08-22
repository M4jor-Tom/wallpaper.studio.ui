# bgsvg studio

A browser editor for `bgsvg` configs. Inputs edit a JSON config and the
rendered SVG updates live -- no more reading `parameters.proto` by hand and
running a binary to see what a change did.

## Running it

```bash
nix run
```

That is the whole thing: it installs dependencies if they are missing, vendors
the renderer module out of the locked revision, starts the dev server and opens
the editor in a window. Run it from a checkout -- it works against your working
tree rather than a built derivation, because vite needs `node_modules` and
`vendor/`, neither of which lives in the Nix store.

On Linux the window is [surf](https://surf.suckless.org/): a bare WebKitGTK
view, no tabs and no toolbar, around 280 MiB resident. That is roughly the
floor -- this editor's JS needs a real engine, so the choice is which WebKit or
Blink, not whether to have one. Closing the window stops the server, and `^C`
in the terminal closes the window; there is no way to leave half of it running.

Because surf has to be told a URL before vite could print one, the port is
pinned to `127.0.0.1:5173`. If something already holds it -- a second editor,
usually -- `nix run` says so and stops rather than opening a window onto it.
For your own browser, another port, or a server with no window, use the
`nix develop` path below.

To work on it rather than just run it:

```bash
nix develop
bun install
bun run dev
```

`nix develop` provides the toolchain: **bun** (runtime, package manager and
TypeScript execution in one binary) and the `bgsvg` CLI used by the drift
check below. Everything else -- `bun run dev`, `bun test`, `bun run build` --
runs inside that shell. Both paths export the same `BGSVG_WASM` from the same
locked revision, so they cannot render through different modules.

## The three columns

| column | holds |
|---|---|
| **controls** | one hand-written widget per config field -- a stepper for the seed, a segmented control per enum, a picker for colour |
| **preview** | the rendered SVG, scaled to fit its pane at the selected output's aspect ratio |
| **JSON** | the config as text; it round-trips, so pasting a config moves the controls and vice versa |

The JSON is the artifact being produced, which is why it gets a column rather
than a drawer. The three columns are a fixed CSS grid -- no draggable
dividers, no persisted widths. Below 1100px the JSON column drops out of the
grid and a header button labelled "JSON" reopens it as a full-width row under
the preview. Below 768px everything collapses into one column with the
preview pinned to the top (`position: sticky`) so the render stays visible
while Controls, Export and JSON scroll beneath it -- there are no tabs.

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
bun run build   # vendors the module's .d.ts/.js/.wasm, then tsc --noEmit, then vite build
```
