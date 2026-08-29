# Lessons

## Verify UI fixes in the real window, not on the wire

**Correction (2026-08-27):** I declared the `nix run` staleness fixed after
adding `Cache-Control: no-store`, having only checked that the header was
present. The user still saw the old UI. `curl` proved the server was correct,
which proved nothing about the browser.

**Pattern:** a response header cannot fix a cache entry that is never
revalidated. Nix normalises every store file's mtime to the epoch, so a static
server's `Last-Modified` is 1970 forever; WebKit derives a heuristic freshness
lifetime of decades from that and serves the entry with **no request at all**.
The new header was never read because the new response was never fetched.

**Rule for myself:** for any change with UI incidence, the proof is the
rendered window, not the HTTP response. Screenshot it (`grim` under niri, surf
window via `niri msg windows`) before saying it works. If the server is
demonstrably right and the window is wrong, the next thing to instrument is the
access log: no request in the log means a cache, and the cache key is the URL.

**Also:** surf's cache lives in `~/.surf/cache/WebKitCache`, not
`$XDG_CACHE_HOME/surf`. Looking in the XDG location and finding nothing is not
evidence that no cache exists.

## `no-store` cannot evict what the cache already holds

**Correction (2026-08-29):** the rust rewrite removed the `?<store name>` key
from the window's URL, on the reasoning that `Cache-Control: no-store` had made
it redundant. `nix run` then opened surf on a months-old UI -- a `JSON` button,
a `Download JSON` next to `Download SVG`, a full-width dock -- while `curl` on
that same port returned the correct page and `~/.surf/cache` held 147 entries.
Deleting that directory fixed the window immediately.

**Pattern:** the two mechanisms govern different tenses. `no-store` stops a
*new* entry from being written; the URL key defeats an entry that *already
exists*, and only a new key can, since the stale entry is answered without a
request (see above: epoch mtime, decades of heuristic freshness) and the header
that would correct it rides on a response nobody fetches. Neither one covers
the other. Everyone upgrading from an older build is the case that breaks, and
"the header makes the key redundant" is the exact wrong inference.

**Rule for myself:** never retire a cache-busting key because a cache header
was added -- ask which tense each one governs, and keep both. When a URL grows
a query key, check what routes on it: `route()` matched the whole URL, so the
very request the key produces answered 404 until the path was split off.

**Also:** this was caught only by looking at the window, which is precisely
what the entry above already said to do. A rule written down here is worth
nothing if it is only reread after the same failure repeats.

## A green `nix flake check` can have built nothing

**Correction (2026-08-29):** the rewritten `flake.nix` dropped `checks`
altogether. `nix flake check` still printed *all checks passed*, and I read
that as the build being clean. It had only evaluated the outputs, and would
have said the same for a package that does not compile.

**Pattern:** `nix flake check` realises the derivations under `checks`; with no
such attribute there is nothing to realise and it degrades into a type-check of
the flake itself. One line fixes it -- `checks.<system>.server` pointing at the
package, whose check phase already runs `cargo test`.

**Rule for myself:** read the line above *all checks passed*.
`running 0 flake checks` means nothing was realised, either because there are
no checks or because the output was already in the store, and neither case
proves the code builds. To show a check genuinely runs, break one assertion,
watch the check fail, and put it back.
