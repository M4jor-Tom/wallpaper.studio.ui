import { expect, test } from "bun:test";
import { esc } from "./form.ts";

test("esc escapes every HTML special character", () => {
  // nothing could reach esc() with hostile content before the JSON pane --
  // now a pasted config can put any of these in a label or a value
  expect(esc(`<script>alert("x") & 'y'</script>`)).toBe(
    "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
  );
});

test("esc escapes & before the other characters so entities are not doubled", () => {
  // if `<` were escaped before `&`, the `&` its own replacement introduces
  // would be re-escaped into `&amp;lt;` on the next pass
  expect(esc("<")).toBe("&lt;");
});
