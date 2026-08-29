# Rust + htmx — the editor without a browser runtime

**Status:** designed · **Date:** 2026-08-29

## Problem

The editor is a TypeScript application that loads the renderer as a WASM
module. That arrangement costs a bun toolchain, a vite build, a `bun.nix`
translation of `bun.lock`, a vendoring step that copies three generated files
into `vendor/`, and a hand-rolled protobuf reader — all so the browser can call
a Rust function that a Rust process could simply call.

Nothing about the editor needs a browser runtime. It has one document, no
routing, no client state beyond a theme preference, and its only real work is
`render(json, w, h)`. Moving that work to a server deletes the entire
JavaScript toolchain and replaces the WASM boundary with a function call.

## Scope

Everything in this repository. The TypeScript is deleted, not ported alongside;
the flake is rewritten; `bgsvg` becomes an ordinary Cargo dependency.

**The UI does not change.** Same ids, same classes, same control order, same
labels, same stylesheet. `src/styles.css` moves to `assets/styles.css` with two
edits, both forced by the loss of JavaScript and both named below.

## Non-goals

- **No Rust in `wallpaper.studio.svg`.** Its API is taken as given. Everything
  this editor needs is already public — see **The library boundary**.
- **No feature work.** No presets, no permalinks, no JSON pane. The Copy JSON
  button was removed in `a3c8366` and is not coming back.
- **No client JavaScript of our own.** htmx is the only script on the page.
  Anything that cannot be expressed in HTML, CSS or an htmx attribute is either
  moved to the server or dropped.
- **No multi-user server.** One process, one window, `127.0.0.1`. There is no
  session store because there is no session.

## The library boundary

`bgsvg` is a Cargo git dependency pinned by `Cargo.lock`:

```toml
bgsvg = { git = "https://github.com/M4jor-Tom/wallpaper.studio.svg.git" }
```

`Cargo.lock` is the only pin. `flake.lock` keeps `nixpkgs` and nothing else;
the `wallpaper-studio-svg` and `bun2nix` inputs are removed. The revision
adopted at design time is `f9ea3ed`, which is exactly what `flake.lock` pinned
beforehand — this migration changes the toolchain, not the renderer.

The cost of the single pin is that `nix build` needs a hash Cargo does not
supply:

```nix
cargoLock.outputHashes."bgsvg-0.1.0" = "sha256-…";
```

That line is maintained by hand and refreshed whenever `cargo update -p bgsvg`
moves the revision. `nix build` reports the correct value when it is wrong, so
the failure is loud and self-describing. Local co-development against a working
tree is a `[patch]` section rather than `--override-input`.

Five public items carry the whole editor:

| item | replaces |
|---|---|
| `bgsvg::render_to_string(json, w, h)` | the WASM `render` export, `src/wasm.ts` |
| `bgsvg::params::parse_res(spec)` | the WASM `resolve_resolution` export |
| `bgsvg::params::RESOLUTIONS` | the WASM `resolutions()` JSON, `parseResolutions` |
| `bgsvg::params::DESCRIPTOR` | `bgsvg --descriptor` piped through `tools/descriptor.ts` |
| `bgsvg::load(json)` → `Scene::slug()` | `export.ts`'s mirrored `slug()` |

The last one matters more than its size. `slug()` was a comment-flagged copy of
the renderer's file-naming vocabulary, kept in step by hand; `lib.rs` builds its
own CLI filename as `trihex-{slug}-{w}x{h}.svg`, and calling that same method
means the download name cannot drift from the CLI's ever again.

`bgsvg`'s `build.rs` shells out to `protoc`, so `PROTOC` is required wherever
this crate is built.

## Architecture

One binary, `wallpaper-studio-ui`, taking `--port N` and defaulting to 5173. It
binds `127.0.0.1` only; nothing here is meant to leave the machine.

No async runtime: `tiny_http` blocks, rendering is CPU-bound and takes
single-digit milliseconds, and there is one user. The request loop is
single-threaded, which is a ceiling worth naming — a second window would wait
its turn — and the upgrade is `tiny_http`'s own thread pool, three lines away
if it is ever wanted.

**The socket is not part of the routing.** Every route is one pure function:

```rust
fn route(method: &Method, url: &str, body: &str, cookie: Option<&str>) -> Reply
struct Reply { status: u16, headers: Vec<(&'static str, String)>, body: String }
```

`main` is a fifteen-line adapter that reads the request, calls `route`, and
writes the `Reply`. Every test drives `route` directly: no port to allocate, no
thread to join, no ordering to get wrong, and the tests run in sandboxes that
forbid loopback connections — which the one this was designed in does.

```
Cargo.toml / Cargo.lock   the renderer pin
src/main.rs               route(), the socket adapter, cookie, responses
src/schema.rs             FIELDS — the one restatement of parameters.proto
src/cfg.rs                form pairs → serde_json config, and visible()
src/page.rs               the view model: FIELDS + form values → Control
templates/page.html       full document
templates/preview.html    fragment: <svg> plus the out-of-band error banner
assets/styles.css         today's stylesheet, two edits
assets/htmx.min.js        htmx 2.0.10, vendored
```

There is no `src/lib.rs` and no `tests/` directory. Tests are `#[cfg(test)]`
modules inside the file they test, because an integration test cannot reach a
binary crate's items and a library target existing only to be tested is a
target nobody ships.

Dependencies are `tiny_http`, `form_urlencoded`, `askama`, `serde_json`, and
`prost`/`prost-types` for the drift test. Only `tiny_http` is new to the
dependency graph; the rest are already compiled as part of `bgsvg`.

**askama rather than `format!`.** Two values reach the markup from the user:
the custom-size field, echoed back into a `value=` attribute, and
`bgsvg::Error`'s message, which quotes what it rejected. Both need escaping.
`form.ts` hand-rolled `esc()` for exactly this; askama escapes by default for
`.html` templates and checks the templates at compile time.

### Routes

| method | path | body | response |
|---|---|---|---|
| GET | `/` | — | the page, with the default config already rendered |
| POST | `/preview` | form | `<svg>` for `#stage`, plus the banner out-of-band |
| POST | `/theme` | form | the page, cookie flipped, form values preserved |
| POST | `/download.svg` | form | `image/svg+xml` as an attachment |
| GET | `/styles.css`, `/htmx.min.js` | — | embedded via `include_str!` |
| — | anything else | — | 404 |

**There is no server-side state.** The form is the config: every request
carries every control's value, the server rebuilds the JSON from those pairs,
renders, and forgets. Two windows do not interfere, and a refresh resets to
defaults — which is what a refresh does today too, the current state being an
in-memory object.

## The zero-JavaScript contract

The `<form id="cfg">` carries **no htmx attributes at all**, so its submit
buttons submit natively. `#stage` listens on its behalf:

```html
<div id="stage" hx-post="/preview" hx-include="#cfg"
     hx-trigger="input delay:100ms from:#cfg" hx-swap="innerHTML">
```

| interaction | mechanism |
|---|---|
| any control changes | htmx POST `/preview`, `<svg>` swapped into `#stage` |
| the 100 ms debounce | `delay:100ms`, the same figure `preview.ts` used |
| the error banner | `hx-swap-oob="true"` on `<p id="error">` in the response |
| the preview never blanking | `HX-Reswap: none` on the error path |
| conditional field hiding | CSS `:has()` |
| Download SVG | `<button formaction="/download.svg">`, native submit |
| theme toggle | `<button formaction="/theme">`, native submit |

`changed` is deliberately absent from `hx-trigger`. It tests the value of the
element the trigger is attached to, and `#stage` is a `<div>` with no value;
the debounce alone gives the behaviour that modifier was there to give.

An attachment response does not navigate, so Download SVG leaves the page
exactly where it was — the same outcome the blob-and-anchor dance produced,
with no lifetime to manage.

### Conditional visibility

`syncForm()` becomes two CSS rules:

```css
/* mirrors visible() in src/cfg.rs */
#controls:has(#f-icon-ship:checked) [data-field^="icon.hexatri"] { display: none; }
#controls:not(:has(#f-overlay-matrix:checked)) [data-field^="overlay.matrix."] { display: none; }
```

`:has()` is not a new bet: `styles.css:207` already relies on it, and the
`hidden` attribute this replaces resolves to `display: none` through the UA
stylesheet, so the rendered result is identical.

The rules are a mirror of `visible()` in `src/cfg.rs`, which decides which keys
reach the JSON. Two places, as today — `form.ts` had `visible()` and the branch
clearing in its `oninput` — but now adjacent and cross-referenced by comment,
and `main.rs`'s route tests pin the server half.

## Form to config

Every control's `name` is its dotted path, because form encoding keys on
`name`. Ids keep their `f-…` spelling so every `for=`/`id=` pair and every CSS
selector is untouched.

`src/cfg.rs` walks `FIELDS` in order, skips any field `visible()` rejects, and
sets the surviving paths on a `serde_json::Value`:

| kind | rule |
|---|---|
| number | empty or unparseable → the key is omitted, matching `clearPath` on `NaN` |
| enum | the posted string, as-is |
| choice | `icon.<branch> = {}`; the branch's own fields then fill it |
| toggle | present in the pairs → create the branch; absent → omit the subtree |
| color | `#rrggbb` from the picker, plus the alpha suffix from the schema default |

An unchecked checkbox is not posted at all, which is HTML's own semantics and a
better fit than reading `.checked` was.

The colour rule is a deliberate simplification, marked in the source. `form.ts`
preserved whatever alpha the *config* carried, because a pasted JSON could set
it. With no JSON pane the config's alpha is always the schema default's, so the
default is the only alpha there is. If a config ever reaches this page by
another route, this is the line to revisit.

The `<output>` beside the colour picker shows the value at render time and is
not updated as the picker moves — which is what it does today, `form.ts` never
having written to it after the initial build. Preserved as-is; it is not a
regression introduced here.

## Preview delivery

The response is the SVG document, swapped into `#stage` as markup. The `<img>`
element, the blob URLs, the `revokeObjectURL` bookkeeping and the
reduced-motion branch in `preview.ts` all go.

Inline was already the styled, supported path: `styles.css:102` describes both
branches and notes that the inline one covers on its own, from the
`preserveAspectRatio="xMidYMid slice"` the renderer emits. Making it the only
path has a bonus — every render ships
`@media (prefers-reduced-motion:reduce){*{animation:none}}` and a resting state
per animated element, and inside an `<img>` that query never sees this page's
preference. Those rest states now always reach a reader who asked for them,
rather than only when JavaScript noticed and switched delivery.

`fitTo()` goes with it. The stage is `object-fit: cover` against a
slice-preserving viewBox, so only the *aspect ratio* reaches the eye, and the
renderer sizes every feature from `min(w,h)/9` — a render at the selected output
resolution is the same picture the export will be, and CSS scales it. Node count
is scale-invariant, so rendering at full resolution costs only digits in the
markup.

## Errors

`bgsvg::Error` is matched directly; there is no `JsValue` to interrogate and
`src/wasm.ts`'s `isRenderError` type guard has nothing left to guard.

`src/json.ts` is deleted outright. Its caret machinery pointed a `^` at the
column serde_json rejected, which mattered when a JSON pane let someone type
malformed configs. The server is now the only author of that JSON, so
`Error::Schema` is unreachable by construction — reaching it would be a bug in
`cfg.rs`, and a bug wants its message, not a caret into text nobody typed.

`Error::Invalid` is the live path: `CLOSEOPEN` with image `NONE` is reachable
from the controls and the renderer rejects it. That message goes to the banner,
via the out-of-band swap on `/preview` and via a full page render on
`/download.svg`. Resolution errors from `parse_res` share the banner, as they do
today.

## Theme, and the one CSS change it forces

The preference is a cookie. `POST /theme` flips it and returns the page with
the posted config intact and `data-theme` already on `<html>`, so a returning
visitor never sees a wrong-theme first paint.

The cost is paid by the visitor who has *not* toggled: no cookie means the
server cannot know their OS preference, and no script runs afterwards to
correct it. So the dark palette must be expressed twice:

```css
:root[data-theme="dark"] { /* …tokens… */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* …the same tokens… */ }
}
```

`light-dark()` would collapse this, and cannot: `--page` is a gradient and
`--lift` a shadow list with different offsets per theme, and `light-dark()`
takes colours only. The duplication is the honest answer and is commented as
such. It replaces today's one-line `color-scheme` mirror, which only had to
prevent a flash because `theme.ts` was about to fix the rest.

The toggle is a native submit, so the address bar ends at `/theme` and a reload
would re-POST. surf has neither an address bar nor a reload button, and this is
a localhost editor; the trade is accepted rather than worked around with an
extra redirect.

## Keeping the form honest

`src/schema.rs`'s `FIELDS` is still the one place this repository restates
something `parameters.proto` already says, and it is still checked rather than
trusted. What changes is where the check lives.

`tools/drift.ts` shelled out to `bgsvg --descriptor` and parsed the
`FileDescriptorSet` with a hand-written protobuf wire reader, because pulling a
protobuf library in for one CI check was not worth it. In Rust the descriptor is
`bgsvg::params::DESCRIPTOR`, a public const from the same locked revision, and
`prost_types::FileDescriptorSet::decode` is already in the dependency graph. So
`tools/descriptor.ts` — 100 lines of wire format — is deleted, and the
comparison in `tools/drift.ts` is ported as-is into `src/schema.rs`'s test
module, including its refusal to report success on a descriptor it plainly
failed to read.

The check moves from `bun run drift`, which had to be remembered, into
`cargo test`, which `nix build` runs in the sandbox. It becomes harder to skip
than it was to run.

## Caching

`Cache-Control: no-store` on every response, including the two embedded assets.

`tasks/lessons.md` records why the previous arrangement needed a
`?<store-name>` query key: darkhttpd served files whose mtime nix had normalised
to the epoch, WebKit derived a freshness lifetime of decades from that, and
served them without asking. The query key was the only cache key that could
reach the browser. A live server sending `no-store` from the very first response
never creates the entry, so the key has nothing left to do and goes.

That lesson also says the proof is the rendered window, not the response. It
applies here: `no-store` is a claim until a screenshot of surf backs it.

## Toolchain

```nix
packages.server  = rustPlatform.buildRustPackage {
  cargoLock.lockFile = ./Cargo.lock;
  cargoLock.outputHashes."bgsvg-0.1.0" = "sha256-…";
  nativeBuildInputs = [ protobuf ];
  PROTOC = "${protobuf}/bin/protoc";
};
packages.default = writeShellApplication (windowed { serve = "server --port 5174"; });
apps.dev         = windowed over `cargo run -- --port 5173`;
devShells        = cargo rustc rustfmt clippy protobuf;
```

`windowed` is unchanged, and so is everything it guarantees: surf on Linux, the
port probed before the window opens, the server and the window dying together,
a message and no window elsewhere. Only what it serves is different. `darkhttpd`
leaves the closure — the server is ours now — and with it the `?query` argument
`windowed` took solely for the cache key.

`packages.site` becomes `packages.server`: a binary rather than a directory of
static files. Anything that depended on `packages.default` sees no change.

`checks.bun-nix` is deleted with the lockfile it guarded. `cargo test` runs in
`buildRustPackage`'s check phase, so `nix build` now enforces the drift check
and the route tests that `nix build .#site` never touched.

The devShell loses bun, bun2nix and the `bgsvg` CLI. It gains nothing that is
not a Rust toolchain, and `BGSVG_WASM` is gone from every path that exported it.

## What is deleted

| file | lines | why |
|---|---|---|
| `index.html` | 35 | `templates/page.html` |
| `src/main.ts` | 75 | `src/main.rs` |
| `src/wasm.ts` | 42 | a function call needs no loader |
| `src/preview.ts` | 111 | htmx swaps the markup; CSS does the fitting |
| `src/export.ts` | 110 | native form submits; `Scene::slug()` |
| `src/form.ts` | 183 | `templates/page.html` and `src/cfg.rs` |
| `src/json.ts` | 29 | `Error::Schema` is unreachable |
| `src/theme.ts` | 27 | a cookie |
| `src/cfg.ts` | 54 | `src/cfg.rs` |
| `src/schema.ts` | 66 | `src/schema.rs` |
| `src/*.test.ts` | 128 | `cargo test` |
| `tools/descriptor.ts` | 100 | `prost_types` |
| `tools/drift.ts` | 66 | `tests/drift.rs` |
| `tools/drift.test.ts` | 66 | `tests/drift.rs` |
| `package.json`, `bun.lock`, `bun.nix`, `tsconfig.json`, `vite.config.ts` | — | no JavaScript toolchain |

`src/styles.css` moves to `assets/styles.css`. `README.md` is rewritten, since
every command it documents stops existing. `docs/superpowers/` history and
`tasks/lessons.md` are untouched.

## Testing

`cargo test`:

- **`src/cfg.rs`** — the form-to-config mapping, one test per rule in the table
  above, plus the two `visible()` predicates.
- **`src/schema.rs`** — `FIELDS` against `bgsvg::params::DESCRIPTOR`.
- **`src/main.rs`** — `route()` called directly, once per route: `/` serves a
  document containing a render; `/preview` returns an `<svg>` and a hidden
  banner; an invalid config returns `HX-Reswap: none` and a banner carrying the
  renderer's message; `/download.svg` carries a `Content-Disposition` whose
  filename matches `Scene::slug()`; `/theme` flips the cookie and echoes the
  posted values back; an unknown path is a 404.

Then, and only then, the window. `tasks/lessons.md` is explicit that a correct
response proves nothing about what surf draws, so the work is not done until a
screenshot of the real window shows the editor rendering, the controls hiding
and revealing, and the theme toggling.

## Behaviour differences a user could notice

1. The preview is inline `<svg>` always, where today it is an `<img>` except
   under `prefers-reduced-motion`.
2. Toggling the theme costs a page render and leaves the address bar at
   `/theme`.
3. Every keystroke is a `127.0.0.1` round trip, debounced at the same 100 ms.
4. The first paint already carries a render, rather than waiting for a module
   to instantiate.

Everything else — the fixed full-bleed stage, the floating dock at
`min(320px, 100%)`, the sticky banner, the segmented controls, the control
order, the labels, the palette — is the same markup against the same
stylesheet.
