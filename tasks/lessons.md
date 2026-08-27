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
