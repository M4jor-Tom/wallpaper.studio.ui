import { expect, test } from "bun:test";
import { errorText } from "./json.ts";

test("errorText puts a caret under the column the module named", () => {
  // the real shape: serde_json's position indexes into JSON.stringify(cfg)
  const source = `{"seed":null}`;
  expect(
    errorText(
      { kind: "schema", message: "data did not match any variant", line: 1, column: 12 },
      source,
    ),
  ).toBe(["data did not match any variant", `{"seed":null}`, "           ^"].join("\n"));
});

test("errorText windows a long line so the caret still lands under its character", () => {
  const source = `{"a":${"0".repeat(200)}}`;
  const out = errorText({ kind: "schema", message: "nope", line: 1, column: 150 }, source).split("\n");
  expect(out[1]).toStartWith("...");
  expect(out[1]).toEndWith("...");
  // the caret column indexes the quoted window, not the original line
  expect(out[2]!.length - 1).toBeLessThan(out[1]!.length);
  expect(out[1]![out[2]!.length - 1]).toBe(source[149]);
});

test("errorText is just the message when there is no position", () => {
  expect(errorText({ kind: "schema", message: "not JSON yet" }, "{}")).toBe("not JSON yet");
  // an "invalid" error is about the config as a whole, and carries none either
  expect(errorText({ kind: "invalid", message: "CLOSEOPEN has nothing to reveal" }, "{}")).toBe(
    "CLOSEOPEN has nothing to reveal",
  );
});

test("errorText survives a line the source does not have", () => {
  expect(errorText({ kind: "schema", message: "m", line: 9, column: 1 }, "{}")).toBe("m");
});
