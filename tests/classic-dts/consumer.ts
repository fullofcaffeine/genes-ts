import type { IMap } from "../../bin/haxe/Constraints.js";
import {
  OverloadedSurface,
  SurfaceImplementation,
  type SurfaceChild
} from "../../bin/tests/publicsurface/SurfaceParent.js";

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

declare const child: SurfaceChild<string>;
const inherited: string[] = child.inherited(["surface"]);
const own: string = child.own("surface");
// @ts-expect-error SurfaceChild<T> applies Array<T> to its parent contract.
child.inherited([1]);

declare const overloaded: OverloadedSurface;
const convertedNumber: number = overloaded.convert(1);
const convertedString: string = overloaded.convert("one");
// @ts-expect-error The captured overload set has no boolean signature.
overloaded.convert(true);

declare const implementation: SurfaceImplementation;
implementation.declaredButUnused("surface");
SurfaceImplementation.declaredStaticButUnused(1);
// Private runtime helpers must not become declaration API.
// @ts-expect-error get_label is an implementation detail behind `label`.
implementation.get_label();
// @ts-expect-error runtimeOnly is retained for JS behavior, not public API.
implementation.runtimeOnly("surface");
// @ts-expect-error suffix is private implementation state.
implementation.suffix;

void maybe;
void definitely;
void inherited;
void own;
void convertedNumber;
void convertedString;

export {};
