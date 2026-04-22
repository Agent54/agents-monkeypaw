type BunFFIArg = "i32" | "u32" | "ptr"
// type BunFFISymbol = {
//   args: BunFFIArg[]
//   returns: BunFFIArg
// }
// type BunFFIDefinitions = Record<string, BunFFISymbol>
// function mapParam(type: BunFFIArg): Deno.NativeType {
//   if (type === "ptr") return "pointer"
//   if (type === "i32") return "i32"
//   return "u32"
// }
// function mapResult(type: BunFFIArg): Deno.NativeResultType {
//   if (type === "ptr") return "pointer"
//   if (type === "i32") return "i32"
//   return "u32"
// }


export const FFIType = {
  void: "void",
  bool: "bool",
  i8: "i8",
  u8: "u8",
  i16: "i16",
  u16: "u16",
  i32: "i32",
  u32: "u32",
  i64: "i64",
  u64: "u64",
  isize: "isize",
  usize: "usize",
  f32: "f32",
  f64: "f64",
  ptr: "ptr",
  pointer: "ptr",
  buffer: "buffer",
  function: "function",
  cstring: "cstring",
} as const

type Type = (typeof FFIType)[keyof typeof FFIType]

function map(type: Type) {
  switch (type) {
    case "ptr":
      return "pointer"
    case "cstring":
      return "pointer"
    default:
      return type
  }
}


// export function ptr(view: ArrayBufferView) {
//   return Deno.UnsafePointer.of(view)
// }
export function ptr(value: ArrayBuffer | ArrayBufferView) {
  return Deno.UnsafePointer.of(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
}

export function dlopen(
  file: string | URL,
  defs: Record<
    string,
    {
      args?: Type[]
      returns?: Type
      nonblocking?: boolean
    }
  >,
) {
  const symbols = Object.fromEntries(
    Object.entries(defs).map(([key, def]) => [
      key,
      {
        parameters: (def.args ?? []).map(map),
        result: map(def.returns ?? FFIType.void),
        nonblocking: def.nonblocking ?? false,
      },
    ]),
  )

  return Deno.dlopen(file instanceof URL ? file : String(file), symbols as Deno.ForeignLibraryInterface)
}

// export function dlopen(path: string | URL, defs: BunFFIDefinitions) {
//   const lib = Deno.dlopen(
//     path instanceof URL ? path : String(path),
//     Object.fromEntries(
//       Object.entries(defs).map(([name, def]) => [
//         name,
//         {
//           parameters: def.args.map(mapParam),
//           result: mapResult(def.returns),
//         },
//       ]),
//     ),
//   )
//   return {
//     symbols: lib.symbols,
//     close: () => lib.close(),
//   }
// }
