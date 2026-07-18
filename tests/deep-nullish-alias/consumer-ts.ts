import {
  DeepNullishAliases,
  type DeepAliasShape
} from "./out/ts/src-gen/deepnullish/DeepNullishAliases.js";
import type { StringMap } from "./out/ts/src-gen/haxe/ds/StringMap.js";

const shape: DeepAliasShape = {
  plain: "plain",
  nullable: null,
  undefinable: undefined
};
const plain: string = DeepNullishAliases.plain(shape.plain);
const nullable: string | null = DeepNullishAliases.nullable(shape.nullable);
const undefinable: string | undefined = DeepNullishAliases.undefinable(
  shape.undefinable
);

declare const plainMap: StringMap<string>;
declare const nullableMap: StringMap<string | null>;
declare const undefinableMap: StringMap<string | undefined>;
const plainMapRead: string | null = DeepNullishAliases.plainMapRead(
  plainMap,
  "key"
);
const nullableMapRead: string | null = DeepNullishAliases.nullableMapRead(
  nullableMap,
  "key"
);
const undefinableMapRead: string | null | undefined =
  DeepNullishAliases.undefinableMapRead(undefinableMap, "key");

// @ts-expect-error The final type is String, so it must not accept null.
DeepNullishAliases.plain(null);
// @ts-expect-error Null<String> allows null, not JavaScript undefined.
DeepNullishAliases.nullable(undefined);
// @ts-expect-error Undefinable<String> allows undefined, not Haxe null.
DeepNullishAliases.undefinable(null);

void plain;
void nullable;
void undefinable;
void plainMapRead;
void nullableMapRead;
void undefinableMapRead;
