import type { IMap } from "../../bin/haxe/Constraints.js";
import {
  OverloadedSurface,
  SurfaceImplementation,
  type SurfaceChild
} from "../../bin/tests/publicsurface/SurfaceParent.js";
import {
  NullishMatrix,
  type NullishMatrixShape
} from "../../bin/tests/nullish/NullishMatrix.js";
import type { DeclarationOnlyShape } from "../../bin/tests/typeonly/DeclarationOnlyShape.js";
import type { WebIdlGapSurface } from "../../bin/tests/webidl/WebIdlGapSurface.js";
import { ConstructorGeneric } from "../../bin/tests/classicdts/ConstructorGeneric.js";

declare const map: IMap<string, number>;
declare const declarationOnlyShape: DeclarationOnlyShape;
declare const webIdl: WebIdlGapSurface;
declare const genericVariant: ConstructorGeneric.Payload<
  string,
  number,
  { readonly label: string }
>;

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

// Haxe 4.3.7's DOM externs use historical WebIDL globals absent from
// TypeScript's lib.dom. The generated StdTypes declaration supplies precise,
// merge-safe compatibility contracts for both values and instances.
webIdl.geolocation.getCurrentPosition(
  (position) => void position.coords,
  (error) => void error.message
);
const observerHandler: (observer: FetchObserver) => void =
  webIdl.observer.handleEvent;
const observerState:
  | "requesting"
  | "responding"
  | "aborted"
  | "errored"
  | "complete" = FetchObserver.prototype.state;
const permissionDenied: 1 = PositionError.PERMISSION_DENIED;

// A constructor-local Haxe type parameter belongs to the variant alias, not
// only to its factory function. This direct alias use proves the payload stays
// precise for declaration consumers instead of widening to `any`.
const genericPayload: { readonly label: string } = genericVariant.value;
const constructedGeneric: ConstructorGeneric<
  { readonly label: string },
  { readonly label: string }
> = ConstructorGeneric.Payload("left", 1, { label: "typed" });
// @ts-expect-error The constructor-local payload is not a number.
const invalidGenericPayload: number = genericVariant.value;

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

// The same shared nullish facts drive classic declaration output. Exact
// optional-property mode makes omission distinct from an explicit undefined
// value and prevents `?` syntax from masking a wrong value union.
const requiredNullish = { nullable: null, undefinable: undefined } as const;
const nullish: NullishMatrixShape = {
  ...requiredNullish,
  typescriptOptional: undefined,
  optionalUndefinable: undefined
};
const nullableValue: string | null = nullish.nullable;
const undefinableValue: string | undefined = nullish.undefinable;
const ordinaryOptionalValue: string | null | undefined = nullish.ordinaryOptional;
const typescriptOptionalValue: string | undefined = nullish.typescriptOptional;
const optionalUndefinableValue: string | undefined = nullish.optionalUndefinable;
const omittedParameter: string | undefined = NullishMatrix.optionalUndefined();
declare const iterator: IterableIterator<string>;
const iteratorStep: IteratorResult<string, undefined> = NullishMatrix.next(iterator);

// @ts-expect-error Null<T> excludes JavaScript undefined.
const invalidNullable: NullishMatrixShape = { ...requiredNullish, nullable: undefined };
// @ts-expect-error Undefinable<T> excludes null.
const invalidUndefinable: NullishMatrixShape = { ...requiredNullish, undefinable: null };
// @ts-expect-error the TS optional projection permits undefined but rejects null.
const invalidTsOptional: NullishMatrixShape = { ...requiredNullish, typescriptOptional: null };
// @ts-expect-error ordinary optional T | null rejects explicit undefined.
const invalidOrdinaryOptional: NullishMatrixShape = { ...requiredNullish, ordinaryOptional: undefined };
// @ts-expect-error explicit undefined parameters must not acquire null.
NullishMatrix.optionalUndefined(null);

void maybe;
void declarationOnlyShape;
void webIdl;
void definitely;
void observerHandler;
void observerState;
void permissionDenied;
void genericPayload;
void constructedGeneric;
void invalidGenericPayload;
void inherited;
void own;
void convertedNumber;
void convertedString;
void nullableValue;
void undefinableValue;
void ordinaryOptionalValue;
void typescriptOptionalValue;
void optionalUndefinableValue;
void omittedParameter;
void iteratorStep;
void invalidNullable;
void invalidUndefinable;
void invalidTsOptional;
void invalidOrdinaryOptional;

export {};
