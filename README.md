# bgsvg studio

A browser editor for `bgsvg` configs. Inputs edit a JSON config and the
rendered SVG updates live -- no more reading `parameters.proto` by hand and
running a binary to see what a change did.

## Running it

```bash
nix run
```

That is the whole thing, and it needs no checkout to be in. The site is built
in the Nix sandbox -- `node_modules` out of `bun.lock`, the renderer out of the
locked revision -- and what runs is the four static files vite emits, served
from the store by [darkhttpd](https://unix4lyfe.org/darkhttpd/). No
`bun install`, no bun at runtime, nothing read from your working tree. Install
it with `nix profile install`, or depend on `packages.default` from another
flake, and it behaves the same way.

On Linux the window is [surf](https://surf.suckless.org/): a bare WebKitGTK
view, no tabs and no toolbar, around 280 MiB resident. That is roughly the
floor -- this editor's JS needs a real engine, so the choice is which WebKit or
Blink, not whether to have one. Closing the window stops the server, and `^C`
in the terminal closes the window; there is no way to leave half of it running.

Because surf has to be told a URL before the server could print one, the port
is pinned: `127.0.0.1:5174` here, `127.0.0.1:5173` for the dev server below, so
the two can run side by side. If something already holds the port -- a second
editor, usually -- the app says so and stops rather than opening a window onto
it. For your own browser, another port, or a server with no window at all,
`nix build .#site` gives you the directory to serve however you like.

To work on the editor rather than just run it:

```bash
nix run .#dev
```

Same window, same shared lifetime, but vite against your working tree, so
edits reload. That one does need a checkout to run from: vite wants
`node_modules` and `vendor/`, neither of which lives in the Nix store. Or take
the pieces apart:

```bash
nix develop
bun install
bun run dev
```

`nix develop` provides the toolchain: **bun** (runtime, package manager and
TypeScript execution in one binary), **bun2nix** (rewrites `bun.nix` from
`bun.lock`, which `bun install` already does for you) and the `bgsvg` CLI used
by the drift check below. Everything else -- `bun run dev`, `bun test`,
`bun run build` -- runs inside that shell. Every path exports the same
`BGSVG_WASM` from the same locked revision, so none of them can render through
a different module.

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
bun test         # unit tests, after vendoring the module's .d.ts/.js/.wasm
bun run drift    # src/schema.ts vs the locked revision's bgsvg --descriptor
bun run build    # vendors the module's .d.ts/.js/.wasm, then tsc --noEmit, then vite build
nix build .#site # the same build, sandboxed, from bun.lock and the lockfile alone
```
