// A minimal protobuf wire reader, just enough to walk a FileDescriptorSet.
// Hand-rolled rather than pulling in a protobuf library, because this reads one
// known message shape and the alternative is a dependency for a CI check.
//
//   FileDescriptorSet   { repeated FileDescriptorProto file = 1 }
//   FileDescriptorProto { string package = 2; repeated DescriptorProto message_type = 4;
//                         repeated EnumDescriptorProto enum_type = 5 }
//   DescriptorProto     { string name = 1; repeated DescriptorProto nested_type = 3;
//                         repeated EnumDescriptorProto enum_type = 4 }
//   EnumDescriptorProto { string name = 1; repeated EnumValueDescriptorProto value = 2 }
//   EnumValueDescriptorProto { string name = 1 }

export type Schema = {
  messages: string[];
  enums: Record<string, string[]>;
};

type Part = { field: number; bytes: Uint8Array };

/**
 * Split one message into its length-delimited (wire type 2) fields, skipping
 * every other wire type -- nothing this reader needs is a varint or fixed.
 */
function parts(buf: Uint8Array): Part[] {
  const out: Part[] = [];
  let i = 0;
  while (i < buf.length) {
    let key = 0;
    let shift = 0;
    while (i < buf.length) {
      const b = buf[i++]!;
      key |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      let len = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++]!;
        len |= (b & 0x7f) << s;
        if ((b & 0x80) === 0) break;
        s += 7;
      }
      if (len < 0 || i + len > buf.length) {
        throw new Error("descriptor: a length prefix runs past the end of the buffer");
      }
      out.push({ field, bytes: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 0) {
      while (i < buf.length && (buf[i++]! & 0x80) !== 0) {
        /* skip varint */
      }
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      throw new Error(`descriptor: unexpected wire type ${wire}`); // groups: not emitted by protoc for proto3
    }
  }
  return out;
}

const str = (b: Uint8Array) => new TextDecoder().decode(b);
const first = (ps: Part[], field: number) => ps.find((p) => p.field === field);
const all = (ps: Part[], field: number) => ps.filter((p) => p.field === field);

function walkEnum(ps: Part[], prefix: string, schema: Schema): void {
  const name = first(ps, 1);
  if (!name) return;
  const full = `${prefix}.${str(name.bytes)}`;
  schema.enums[full] = all(ps, 2)
    .map((v) => first(parts(v.bytes), 1))
    .filter((n): n is Part => n !== undefined)
    .map((n) => str(n.bytes));
}

function walkMessage(ps: Part[], prefix: string, schema: Schema): void {
  const name = first(ps, 1);
  if (!name) return;
  const full = `${prefix}.${str(name.bytes)}`;
  schema.messages.push(full);
  for (const nested of all(ps, 3)) walkMessage(parts(nested.bytes), full, schema);
  for (const e of all(ps, 4)) walkEnum(parts(e.bytes), full, schema);
}

export function parseDescriptor(bytes: Uint8Array): Schema {
  const schema: Schema = { messages: [], enums: {} };
  for (const file of all(parts(bytes), 1)) {
    const ps = parts(file.bytes);
    const pkg = first(ps, 2);
    const prefix = pkg ? `.${str(pkg.bytes)}` : "";
    for (const m of all(ps, 4)) walkMessage(parts(m.bytes), prefix, schema);
    for (const e of all(ps, 5)) walkEnum(parts(e.bytes), prefix, schema);
  }
  return schema;
}
