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
labels, same stylesheet. `src/styles.css` moves to `assets/styles.css` with
five edits of substance, each named below:

- the two `:has()` rules that replace `syncForm()`'s `hidden` attribute
- the dark palette stated twice, replacing the one-line `color-scheme` mirror
  that only had to hold until `theme.ts` ran
- the theme rules, which are new: the label `theme.ts` wrote into one button is
  now a choice between two, and CSS is what picks
- the dock's grid moving from `<main>` to `#cfg`, one level in, since the
  controls gained a `<form>` around them
- the covering rule moving from `#preview` to `#stage > svg`, dropping
  `object-fit: cover` with it — that property only ever reached the `<img>`
  branch, and the inline branch covers from its own `preserveAspectRatio`

That the list grows is not the claim eroding. Every one of them either keeps
the rendered result identical across a structural change — a new element to
select, a grid one level down — or restores in CSS exactly what a deleted
script did. None of them changes what a reader sees, which is what the claim
says.

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

`main` parses `--port` and binds; `serve` is a twenty-line adapter that reads
the request, calls `route`, and writes the `Reply`. Every test drives `route`
directly: no port to allocate, no
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
assets/styles.css         today's stylesheet, five edits
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
| POST | `/` | form | the page again, from the posted form; nothing else changes |
| POST | `/preview` | form | `<svg>` for `#stage`, plus the banner out-of-band |
| POST | `/theme` | form | the page, cookie set to the target the pressed button named, form values preserved |
| POST | `/download.svg` | form | `image/svg+xml` as an attachment |
| GET | `/styles.css`, `/htmx.min.js` | — | embedded via `include_str!` |
| — | anything else | — | 404 |

`POST /` exists because the dock is a `<form>`. Enter in *Custom size* — the
only free-text field on the page — is implicit submission, and implicit
submission presses the form's default button whether or not anyone designed
one. The theme buttons are form-owned and precede `#dl-svg` in tree order, so
that button was a theme button: the reflex gesture in a text field flipped the
palette and persisted a cookie nobody asked to change. A `hidden` submit ahead
of them in `<header>` takes the role instead and posts here, so Enter means
"apply" — the render every keystroke already produced, the theme in force left
alone, no cookie written. It also closes a trap `#cfg` sets by having no
`action`: a submit button without a `formaction` posts to the document URL,
which on the store-keyed entry URL below is `/` carrying a query — a 404 until
this route existed.

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
| Enter in a text field | the `hidden` default button, native submit to `/` |

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

`fitTo()` goes with it. The stage is a fixed full-window box and the `<svg>`
inside it covers from its own `preserveAspectRatio` — `object-fit` never
reached an inline SVG and goes with the `<img>` it was there for. So only the
*aspect ratio* reaches the eye, and the renderer sizes every feature from
`min(w,h)/9` — a render at the selected output resolution is the same picture
the export will be, and CSS scales it. Node count
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

## Theme, and the CSS changes it forces

The preference is a cookie. `POST /theme` sets it to the target the pressed
button named and returns the page with the posted config intact and
`data-theme` already on `<html>`, so a returning visitor never sees a
wrong-theme first paint.

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

That same blindness is why `/theme` reads a target instead of flipping the
cookie. Before one exists the server cannot tell which palette is on screen —
no cookie reads as "not dark", exactly as light does — so a flip sent every
dark-OS visitor's first press *to* dark, the palette they were already looking
at, and the press looked like it had done nothing. `theme.ts` never had this
problem: it read the media query at load and always knew the true current
theme. Putting the destination in the request moves the one fact the server is
missing along with it. So: two buttons, one per destination, each labelled with
the palette it is shown *under* — the current one, exactly as the single old
button read — and carrying where a press goes in its `value`, with CSS picking
which of the two is in the tree. The old blind flip survives only as the
fallback for a POST that is neither button.

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
reach the browser.

**The header does not retire the key.** The two govern different tenses:
`no-store` stops a *new* entry from being written, and only a new URL defeats
an entry that *already exists*. Nothing in a response can reach the second
case, because the stale entry is answered with no request at all — the header
that would correct it rides on a response the browser never fetches. Everyone
upgrading from an older build is exactly that case, and this document said "the
key has nothing left to do" until `nix run` put a months-old UI in the window
to prove otherwise. So `windowed` keeps its `query` argument and
`packages.default` passes the server's store name, which changes exactly when
its contents do. Only the document needs the key: the two assets come from the
same binary, and the document that references them is what the key re-fetches.

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
packages.default = writeShellApplication (windowed {
  serve = "server --port 5174";
  query = "?${baseNameOf server}";   # the cache key -- see Caching
});
apps.dev         = windowed over `cargo run -- --port 5173`;
checks.server    = packages.server;
devShells        = cargo rustc rustfmt clippy protobuf;
```

`windowed` is unchanged, and so is everything it guarantees: surf on Linux, the
port probed before the window opens, the server and the window dying together,
a message and no window elsewhere. Only what it serves is different: `darkhttpd`
leaves the closure — the server is ours now — while the `?query` argument stays,
for the reason **Caching** gives.

`packages.site` becomes `packages.server`: a binary rather than a directory of
static files. Anything that depended on `packages.default` sees no change.

`checks.bun-nix` is deleted with the lockfile it guarded. `cargo test` runs in
`buildRustPackage`'s check phase, so `nix build` now enforces the drift check
and the route tests that `nix build .#site` never touched.

`checks.server` is that same package, and it is one line for a reason: `nix
flake check` realises whatever `checks` holds, so with the attribute deleted
alongside `checks.bun-nix` it printed *all checks passed* having compiled
nothing — it had only type-checked the flake, and would have said the same for
a package that does not build. Pointing it at `packages.server` buys a
`nix flake check` that compiles the binary and runs the tests.

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
| `tools/drift.ts` | 66 | `src/schema.rs`'s test module |
| `tools/drift.test.ts` | 66 | `src/schema.rs`'s test module |
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
  filename matches `Scene::slug()`; `POST /` echoes the posted config back with
  the theme untouched and no `Set-Cookie`; `/theme` sets the cookie to the
  target it was sent and echoes the posted values back; an unknown path is a
  404.

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
5. Enter in *Custom size* re-renders and leaves the address bar at `/`, where
   with no form on the page it used to do nothing at all.

Everything else — the fixed full-bleed stage, the floating dock at
`min(320px, 100%)`, the sticky banner, the segmented controls, the control
order, the labels, the palette — is the same markup against the same
stylesheet.
