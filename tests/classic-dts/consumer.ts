import type { IMap } from "../../bin/haxe/Constraints.js";

declare const map: IMap<string, number>;

const maybe: number | null = map.get("present");
map.set("present", 1);
map.exists("present");
map.remove("present");
map.keys();
map.iterator();
map.keyValueIterator();
map.copy();
map.toString();
map.clear();

// `Map.get` can be absent. If its declaration widens to `any`, this expected
// error becomes unused and TypeScript fails the test.
// @ts-expect-error Null<V> must not be assignable directly to V.
const definitely: number = map.get("missing");

// Classic declaration interfaces should remain closed as well.
// @ts-expect-error Unknown members are not part of haxe.Constraints.IMap.
map.nonexistentMember();

void maybe;
void definitely;

export {};
