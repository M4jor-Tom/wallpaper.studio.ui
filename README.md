# bgsvg studio

A browser editor for `bgsvg` configs. Inputs edit a JSON config and the
rendered SVG updates live -- no more reading `parameters.proto` by hand and
running a binary to see what a change did.

## Running it

```bash
nix run
```

That is the whole thing, and it needs no checkout to be in. What runs is one
binary: the stylesheet and a vendored copy of htmx are compiled into it, the
renderer is linked in as a library, and the SVG is drawn in the same process
that serves the page. No bun, no `node_modules`, no bundler, nothing read from
your working tree. Install it with `nix profile install`, or depend on
`packages.default` from another flake, and it behaves the same way.

On Linux the window is [surf](https://surf.suckless.org/): a bare WebKitGTK
view, no tabs and no toolbar, around 280 MiB resident. That is roughly the
floor -- an SVG this size has to be drawn by a real engine, so the choice is
which WebKit or Blink, not whether to have one. Closing the window stops the
server, and `^C` in the terminal closes the window; there is no way to leave
half of it running.

Because surf has to be told a URL before the server could print one, the port
is pinned: `127.0.0.1:5174` here, `127.0.0.1:5173` for the dev server below, so
the two can run side by side. If something already holds the port -- a second
editor, usually -- the app says so and stops rather than opening a window onto
it. For your own browser, another port, or a server with no window at all,
`nix build .#server` gives you the binary; it takes `--port N`, and 5173 is
what it picks without one.

To work on the editor rather than just run it:

```bash
nix run .#dev
```

Same window, same shared lifetime, but cargo over your working tree. Nothing
reloads by itself any more -- the page is built by the binary, so there is no
HMR left to speak of -- and a rebuild is a `^C` and a rerun. That one does need
a checkout to run from. Or take the pieces apart:

```bash
nix develop
cargo run
```

`nix develop` provides the toolchain: **cargo** and **rustc**, **clippy** and
**rustfmt**, and the **protoc** that `bgsvg`'s build script shells out to.
Everything else -- `cargo run`, `cargo test`, `cargo clippy` -- runs inside
that shell. Every path links the same `bgsvg` revision, the one `Cargo.lock`
names, so none of them can render through a different module.

## The two layers

| layer | holds |
|---|---|
| **stage** | the rendered SVG, fixed to the window and cropped to it, at the selected output's aspect ratio |
| **dock** | one hand-written widget per config field -- a stepper for the seed, a segmented control per enum, a picker for colour -- plus the export controls, floating on the render |

A wallpaper is judged full-bleed, so the render is the page rather than a
picture on it: giving it a column could only letterbox it, since the window's
aspect ratio is not the output's. The dock is one translucent card over the
top-left of it -- `--glass` is `--panel` at 86%, which is as transparent as it
can be and still hold its labels at 4.5:1 over a render of any colour. It is
`min(320px, 100%)` wide and scrolls inside itself, so the render stays whole at
every window size and there are no tabs, no draggable dividers, no
breakpoints of its own.

The config never appears as text: it goes in through the controls, and the
only thing that comes back out is a render.

## How it works

One page and one form. Every control's `name` is its dotted path into the
config -- `seed`, `background.motion`, `overlay.matrix.color` -- so the form is
the config, spelled the only way a browser can spell one. Typing anywhere in
it posts the whole form to `/preview`; the server rebuilds the JSON from those
paths, renders it, and htmx swaps the SVG into the stage. A config the renderer
refuses does not blank the stage: the reply carries the reason into the banner
out of band and tells htmx to swap nothing, so the last good render stays up
while you finish typing.

There is no server-side state. Nothing is remembered between requests -- the
form that arrives is the whole truth -- so a refresh is a reset to defaults.
htmx is the only script on the page, and it is served from the binary rather
than a CDN. The theme is the one thing that outlives a request, and it is a
cookie.

## The renderer

Rendering is `bgsvg` itself, linked in: a Cargo git dependency on the
`wallpaper.studio.svg` repository, with `Cargo.lock` naming one exact
revision. That lockfile is the only pin there is now -- `flake.lock` holds
nixpkgs and nothing else -- and the descriptor the drift check reads is
compiled into that same revision, which is what makes the check meaningful.

Two things follow from that:

- **`cargo update -p bgsvg`** adopts a newer revision as a deliberate act and
  records it in `Cargo.lock`. Cargo stores no hash for a git dependency, so
  `flake.nix` has to carry one: `cargoLock.outputHashes."bgsvg-0.1.0"` must be
  refreshed to match, and `nix build` prints the value it wanted when it is
  not.
- **A `[patch]` section in `Cargo.toml`** builds against a local
  `wallpaper.studio.svg` working tree, for co-development across both
  repositories, without touching the lock or requiring a commit there:

  ```toml
  [patch."https://github.com/M4jor-Tom/wallpaper.studio.svg.git"]
  bgsvg = { path = "../wallpaper.studio.svg" }
  ```

  Cargo honours it; `nix build` cannot, since the sandbox has no such tree.
  Take it back out before committing.

## Checks

```bash
cargo test         # config mapping, templates, routes, and the drift check
cargo clippy --all-targets -- -D warnings
nix build .#server # the same tests, sandboxed, from Cargo.lock alone
```

The drift check is one of those tests now -- `src/schema.rs`'s `FIELDS`
against `bgsvg::params::DESCRIPTOR` -- so a value added upstream fails the
suite instead of quietly going missing from the form. It used to be
`bun run drift`, a separate command nobody remembered to run. `nix flake check`
realises the same package, so it too compiles the server and runs the tests
rather than only evaluating the flake.
