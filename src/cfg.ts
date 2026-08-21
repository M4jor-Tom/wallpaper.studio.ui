// The config object IS the JSON -- there is no model mirroring it. Both the
// form and the JSON pane mutate this shape directly, so what the user sees in
// the JSON column is literally the object being rendered.
export type Cfg = Record<string, unknown>;

/**
 * `{}` is a complete config: every proto3 zero is the renderer's default, so
 * spelling them out here would only create a second place for them to drift.
 */
export function defaults(): Cfg {
  return {};
}

export function getPath(cfg: Cfg, path: string): unknown {
  let node: unknown = cfg;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Cfg)[key];
  }
  return node;
}

export function setPath(cfg: Cfg, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  let node = cfg;
  for (const key of keys) {
    const next = node[key];
    if (typeof next !== "object" || next === null) node[key] = {};
    node = node[key] as Cfg;
  }
  node[last] = value;
}

/**
 * Remove a branch, then prune any parent it leaves empty. An empty object
 * serialises as `"overlay": {}`, which is a different config from one with no
 * overlay at all -- the renderer treats the presence of the key as the switch.
 */
export function clearPath(cfg: Cfg, path: string): void {
  const keys = path.split(".");
  const chain: Cfg[] = [cfg];
  let node: Cfg = cfg;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== "object" || next === null) return;
    node = next as Cfg;
    chain.push(node);
  }
  delete node[keys[keys.length - 1]!];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]!).length === 0) delete chain[i - 1]![keys[i - 1]!];
  }
}
