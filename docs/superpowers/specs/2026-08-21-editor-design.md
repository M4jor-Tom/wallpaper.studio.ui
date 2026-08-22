# Editor — a browser UI for the bgsvg config

**Status:** implemented · **Date:** 2026-08-21

## Problem

Writing a `bgsvg` config by hand means reading `parameters.proto`, and seeing
the result means running a binary and opening a file. This collapses both:
inputs edit the config, and the render appears as you type.

## Scope

Everything in this repository: the page, its controls, its state, its styling,
and the tooling that vendors and checks its one dependency.

That dependency is a WASM build of the `bgsvg` renderer, produced by the
`svg_builder` repository and specified there
(`docs/superpowers/specs/2026-08-21-wasm-target-design.md`). This document
treats that module's API as given.

## Non-goals

- **No Rust.** No renderer behaviour, no schema change, no work inside
  `svg_builder`. If something is missing from the module's API, that is a
  request against its spec, not a change made here.
- **No reimplementation of anything the module already does.** Resolution
  parsing, validation, and defaults are called, never re-derived. The single
  exception is the form's own field list, which is checked against the schema
  rather than trusted — see **Keeping the form honest**.
- **No preset gallery.** Rendering the 42 corpus configs as live thumbnails is
  a performance problem that wants build-time static thumbnails or a
  render-on-hover cache. Out of scope.
- **No URL permalink**, no server, no persistence beyond the theme preference.
- **No preview performance controls.** No pause toggle and no preview-resolution
  selector; `prefers-reduced-motion` already gives a system-level pause, and
  the preview sizes itself (see **Preview**).

## Toolchain and dependency

`flake.nix` handles both, and is the only thing this repository asks anyone to
install. Its devShell provides **bun** — runtime, package manager and
TypeScript execution in one binary — and nothing it can avoid. Vite still does
the bundling and the dev server, run under bun: it is the better-proven path
for loading a WASM module and for HMR, and bun's own bundler buys little at
this size.

`svg_builder` is declared as a flake input pointing at its remote, so
`flake.lock` pins a revision:

```nix
inputs.svg_builder.url = "git+ssh://git@github.com/M4jor-Tom/theta_svg_builder.py.git";
```

Three artifacts come from that one locked revision:

| artifact | from | used for |
|---|---|---|
| `.wasm` + JavaScript glue | `${packages.bgsvg-wasm}/web` | rendering |
| generated `.d.ts` | `${packages.bgsvg-wasm}/web` | typechecking the ABI |
| `descriptor.bin` | `${packages.default}/bin/bgsvg --descriptor` | the drift check |

That package emits two subdirectories from one `.wasm` — `web/` for a bundler
to consume, and `nodejs/` for the byte-identity sweep upstream. Only the
JavaScript glue differs between them, so rendered bytes cannot.

One revision for all three is a requirement, not a convenience: a drift check
run against a different revision's descriptor than the module was built from
proves nothing. `flake.lock` guarantees that.

`descriptor.bin` is never written to disk: `tools/drift.ts` invokes
`bgsvg --descriptor` directly from the dev shell and reads its output, so
there is nothing to vendor or go stale for the drift check itself.

The `.wasm` and its generated `.d.ts` are different: `tsconfig` needs the
`.d.ts` inside the project, so `package.json`'s `types` script copies it,
together with the runtime `.js`/`.wasm` glue, from `$BGSVG_WASM` into a
git-ignored `vendor/`. That copy source is still the store path `flake.lock`
pins, so the single-revision guarantee is intact -- what a hand-managed step
changes is how much of that one revision is copied onto disk, not where it
comes from.

The API surface is typechecked rather than trusted — `wasm-bindgen` emits the
`.d.ts`, so an ABI change at a new pin fails `tsc` rather than at runtime.

Two workflow consequences follow from pinning a *remote* revision:

- Changes in `svg_builder` reach this repository only once **pushed**.
  `nix flake update svg_builder` then adopts them as a deliberate act, and the
  lockfile records which revision the editor was built against.
- For co-development across both repositories,
  `nix develop --override-input svg_builder path:../svg_builder` builds against
  a local working tree without touching the lock or requiring a commit.

The flake does not package the site itself; building stays `vite build` inside
the devShell. Adding a `packages.site` output later means packaging node
dependencies in Nix, which is real work and buys nothing yet.

## Decisions

**Vanilla TypeScript, built with Vite. No framework.** Eight controls do not
justify a runtime -- each `oneof` (`icon`, `overlay.matrix`) needs a branch
selector *and* the selected branch's own fields, so the form is seed,
background.motion, background.image, icon glyph, icon.hexatri.motion, matrix
on/off, matrix angle and matrix colour. State is one object and re-rendering
is one function call,
so the whole reactive layer is roughly 30 lines. Shipping 0 KB of framework
matters when the payload already carries a WASM module.

**Three columns: controls · preview · JSON.** The JSON is the artifact being
produced, so it gets a column rather than a drawer, and it round-trips — a
control writes into it, and pasting a config moves the controls. That is how a
corpus config or a `docs/mood/samples/` file gets loaded.

The cost of three columns is preview width, so both dividers drag with
persisted widths, and the JSON column collapses to a labelled rail via a
chevron.

**Blueprint is the light theme, Void is the dark.** One design system, two
token sets, defaulting to `prefers-color-scheme` with an override persisted to
`localStorage`. Every value is taken from the renderer's own palette
(`src/style.rs`, documented in `docs/mood/README.md`); the dark accents are the
*undarkened* hues the starfield nebula uses, so the dark theme introduces no
third hue.

| role | light — Blueprint | dark — Void |
|---|---|---|
| page | `#eef3f6` → `#dde6ec` | `#16212a` (`VOID`) |
| panel | `#f3f7f9` | `#1a2731` |
| field | `#fbfdfe` | `#22323e` |
| ink | `#2a424f` | `#d3e1e9` |
| accent | `#365665` | `#6fb7d1` |
| accent-2 | `#395e53` | `#77c9a6` |

The rendered SVG is high-key under both themes, because it is light-only by
design. Under Void it reads as a lit panel on the void, isolated by a shadow
where the light theme uses a hairline.

**Export downloads the `.svg` and the `.json`.** The resolution comes from
`resolutions()` as a dropdown, plus a free-text field for `WIDTHxHEIGHT`
validated by `resolve_resolution` — so an invalid size is rejected by the same
code the CLI uses.

## Keeping the form honest

The controls are hand-written, one per field, shaped to fit it: a stepper for
`seed`, a segmented control per enum, a picker for `color`. A form generated
from the descriptor could not drift, but it yields a generic widget per type,
and every override needed to make it presentable rebuilds the hand-written form
underneath a descriptor walker.

So `src/schema.ts` **declares** the fields and enum values the form offers, and
`tools/drift.ts` compares that declaration against `bgsvg --descriptor`,
invoked directly from the dev shell rather than vendored to disk, failing CI
when the schema holds a value the form does not. `schema.ts` is also what the
form is built from, so a field cannot be in the check and missing from the UI.

Nothing upstream catches this: `valid_configs` enumerates the Rust enums, so a
new `Background.Motion` variant grows both of `svg_builder`'s test surfaces and
still never reaches these controls.

## Modules

```
src/schema.ts     declared fields + enums — one source for the form and the drift check
src/form.ts       builds controls from schema.ts, writes into cfg
src/json.ts       the JSON pane, round-trips with cfg
src/preview.ts    wasm call, blob swap, debounce
src/export.ts     download .svg at a resolution, copy/download .json
src/theme.ts      Blueprint/Void, prefers-color-scheme default, localStorage override
src/main.ts       wiring
src/styles.css    tokens and the three-column grid
tools/drift.ts    descriptor.bin vs schema.ts — CI
flake.nix         devShell (bun) + svg_builder as a locked input
```

## Data flow

One mutable `cfg` object, which *is* the JSON rather than a model mirroring it.

```
form input ──┐                        ┌──> serialize ──> JSON pane
             ├──> cfg ──> render() ───┤
JSON edit  ──┘                        └──> wasm(cfg, w, h) ──> blob ──> <img>
```

While the JSON pane holds focus it owns `cfg` and nothing serializes back into
it; otherwise the form owns it. Without that arbitration, writing to the pane
on every keystroke fights the cursor.

Enum clicks render immediately. Continuous inputs — seed, angle, colour —
debounce at 100 ms. What is debounced is the browser reparsing the document,
not the render itself, which is single-digit milliseconds.

## Preview

The preview renders at the **selected output aspect ratio, scaled to fit its
pane**. This is exact rather than approximate: the renderer sizes everything
from `min(w,h)/9` at spacing `2s`, so scaling `w` and `h` by one factor scales
`s` identically and leaves the cell count — and therefore every RNG draw —
unchanged. A 640×360 preview is a true scale model of 1920×1080 from the same
seed.

It is also the cheap path, which is why no preview-resolution control is
needed: paint cost follows pixel area, composition does not.

The document goes into an `<img>` through `URL.createObjectURL`, **revoking the
previous URL on every swap**. Skipping that leaks a 48–222 KB blob per
keystroke — the one way this design would quietly become a memory consumer.
An `<img>` also keeps roughly 1800 animated nodes out of the main document's
style tree under `CLOSEOPEN` with `STARFIELD`, which `docs/mood/README.md`
measures at ~1 GB of renderer memory when inlined.

## Errors

The preview never blanks. It holds the last valid render.

The module throws `{ kind, message, line?, column? }`, and `kind` is what routes
it:

| `kind` | where it surfaces |
|---|---|
| `"schema"` | the offending line in the JSON pane, underlined, using `line`/`column` |
| `"invalid"` | a banner above the fieldset the message names |
| — (a trap) | a banner, and the module is reinitialised |

Only one `"invalid"` error is reachable from the controls — `CLOSEOPEN` with
`NONE` — because the angle slider is bounded to 0–360, the colour comes from a
picker, and the enums are segmented controls that cannot hold an unknown value.
Its message names both fields, so it renders above the Background fieldset. Any
other `"invalid"` can only arrive from the JSON pane, and shows there.

## Type, accessibility, responsiveness

System stack for UI text, `ui-monospace` for values, labels and JSON: no font
downloads, and the sans/mono split does the technical-drawing work the palette
implies.

Segmented controls are `<input type="radio">` inside a `<fieldset>` with a
`<legend>`, styled — keyboard navigation and screen-reader semantics come from
the elements rather than reconstructed ARIA. Labels are visible, focus rings
are kept, touch targets are at least 44×44 in the narrow layout, and the
preview `<img>` takes its `alt` from the config's slug, which already reads as
a description: *lights-rotate-hexatri-space-matrix*. Every text-on-background
pair is verified at 4.5:1.

Breakpoints: three columns at ≥1100px; between 768px and 1100px the JSON column
collapses to a rail and reopens as an overlay; below 768px the preview pins to
the top with Form and JSON as two tabs beneath, so the render stays visible at
every width.

## Testing

- **`tools/drift.ts`** in CI — fails when `descriptor.bin` holds a field or
  enum value `schema.ts` does not declare.
- **A round-trip test** — `form → cfg → JSON → parse → cfg` is stable,
  including the focus-arbitration path.
- **Browser verification** via `playwright-cli`, per the agent instructions.

## Verified during implementation

**No -- `prefers-reduced-motion` does not resolve inside the `<img>`-loaded
SVG.** The rendered SVG carries its own `<style>` with
`@media (prefers-reduced-motion: reduce){*{animation:none!important}}`, so the
rule reaches the browser. But loading a config with `background.motion =
LIGHTS` in Chromium via `playwright-cli`, capturing `#preview` twice a second
apart under `page.emulateMedia({ reducedMotion: 'reduce' })`, showed the two
captures differing by the same order of magnitude as the two captures taken
without that emulation (~12.6% of RGBA bytes changed either way, against a
verified-zero baseline for a genuinely static config) -- the animation keeps
running. The top-level document's own `matchMedia('(prefers-reduced-motion:
reduce)')` correctly reports `true` throughout, so the preference reaches the
page; it just does not reach the image resource `<img>` decodes and renders
internally. This matches the `<img>`-vs-`<iframe>` distinction Chromium draws
for media-feature emulation: an `<iframe>` is a nested browsing context that
inherits it, an `<img>` is decoded through the image-resource pipeline, which
does not.

This was checked against Playwright's *emulated* `prefers-reduced-motion`
under Chromium specifically; a real OS-level preference was not available to
test in this environment, so whether it fares differently is unconfirmed.

Per the design's own instruction, this is reported rather than acted on: an
inline `<svg>` is the fallback this finding would motivate, and that trade
costs the ~1800 animated nodes this delivery mechanism exists to keep out of
the main document's style tree. Adopting it is the controller's call.

**The module's download size**, which is measured upstream but budgeted here.
It dominates the payload; ~8 KB of JavaScript and ~4 KB of CSS do not.
