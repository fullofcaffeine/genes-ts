import {UnknownNarrow} from "../genes/ts/UnknownNarrow.js"
import {Register} from "../genes/Register.js"

export type UnknownMap = {[key: string]: unknown}

export type MaybeName = string | undefined

export type MaybeNameRecord = {
	name: MaybeName
}

export type MutableMaybeNameRecord = {
	name: MaybeName
}

export type OptionalMaybeNameRecord = {
	name?: MaybeName
}

export type OptionalDirectUndefinableRecord = {
	name?: string | undefined
}

export type MaybeFlagRecord = {
	enabled: boolean | undefined
}

export type MaybeFlagBridgeShape = {
	enabled: boolean | undefined
}

export type OptionalArrayRecord = {
	items?: string[] | null
}

export type OptionalNameRecord = {
	label?: string | null
}

export type OptionalNameChild = {
	label?: string | null
}

export type OptionalNestedNameRecord = {
	child?: OptionalNameChild | null
}

export type NativeFunctionPayload = {
	arguments: string,
	name: string
}

export type NativeOptionalPayload = {
	description: string | undefined
}

export type OptionalWarning = {
	feature: string
}

export type OptionalWarningsRecord = {
	warnings: OptionalWarning[] | undefined
}

export type FieldOverrideNested = {
	raw: string
}

/**
* Fixture for TS optional-property contracts without changing Haxe field types.
*
* Why: this is the preferred way to model JavaScript DTO fields that are
* omitted/undefined at the TypeScript boundary but still read as normal
* `Null<T>` from Haxe source. It avoids broad `Undefinable<T>` wrappers and
* avoids per-field string type overrides when the Haxe type is already right.
*
* What/How: `@:ts.optional` changes anonymous typedef field type emission to
* `field?: T | undefined`. The explicit undefined member is required because
* genes may preserve an own property whose value is undefined; it also keeps
* function-valued fields grouped as `((...) => T) | undefined`. Object
* literals and reads otherwise retain ordinary Haxe optional-field behavior.
*/
export type TsOptionalRecord = {
	kind?: ("primary" | "secondary") | undefined,
	label?: string | undefined,
	nested?: FieldOverrideNested | undefined,
	parse?: ((arg0: string) => number) | undefined,
	tags?: string[] | undefined
}

/**
* Fixture for boundary-only TypeScript field type overrides.
*
* Why: most records should rely on inferred Haxe types, or on semantic markers
* such as `@:ts.optional` when the mismatch is recurring and well understood.
* Field-level `@:ts.type` remains available for lower-level boundaries where
* the canonical TypeScript projection cannot be expressed directly in Haxe,
* such as readonly arrays, imported ecosystem types, or host function shapes.
*
* What/How: each field keeps its Haxe type for object literals and normal
* Haxe reads. genes-ts uses the metadata only when printing this anonymous
* typedef field in generated TS source and declaration output.
*/
export type FieldOverrideRecord = {
	label?: string,
	nested?: FieldOverrideNested,
	parse?: (value: string) => number,
	tags?: readonly string[]
}

/**
* Fixture for Haxe-safe aliases over external JavaScript property names.
*
* `function` is a TypeScript/JavaScript keyword, so Haxe source uses `fn`.
* `@:native("function")` requires generated TS types, object literals, and
* field access to use the runtime property name while Haxe keeps typechecking
* against the safe alias.
*/
export type NativeFunctionRecord = {
	function: NativeFunctionPayload
}

export type NativeOptionalRecord = {
	function: NativeOptionalPayload
}

export type NativeFunctionChoice = string | NativeFunctionRecord

export class BoundaryTypes {
	static unknownValue<T>(value: T): unknown {
		return value;
	}
	static missingName(): MaybeName {
		return undefined;
	}
	static presentName(): MaybeName {
		return "Ada";
	}
	static missingRecord(): MaybeNameRecord {
		return {"name": undefined};
	}
	static localMissingName(): MaybeName {
		let name: MaybeName = undefined;
		return name;
	}
	static chooseName(present: boolean): MaybeName {
		if (present) {
			return "Ada";
		} else {
			return undefined;
		};
	}
	static assignMissingName(): MutableMaybeNameRecord {
		let out: MutableMaybeNameRecord = {"name": "Ada"};
		out.name = undefined;
		return out;
	}
	static assignChosenName(present: boolean): MutableMaybeNameRecord {
		let out: MutableMaybeNameRecord = {"name": undefined};
		out.name = (present) ? "Ada" : undefined;
		return out;
	}
	static conditionalFlagRecord(present: boolean): MaybeFlagRecord {
		let enabled: boolean | null = (present) ? true : null;
		return {"enabled": (enabled == null) ? undefined : enabled};
	}
	static conditionalFlagBridge(present: boolean): { enabled: boolean | undefined } {
		let enabled: boolean | null = (present) ? true : null;
		return {"enabled": (enabled == null) ? undefined : enabled};
	}
	static optionalMissingName(): OptionalMaybeNameRecord {
		let out: OptionalMaybeNameRecord = {};
		out.name = undefined;
		return out;
	}
	static optionalDirectMissingName(): OptionalDirectUndefinableRecord {
		let out: OptionalDirectUndefinableRecord = {};
		out.name = undefined;
		return out;
	}
	static fieldOverrideRecord(): FieldOverrideRecord {
		return {"label": "Ada", "tags": ["compiler", "types"], "parse": function (value: string) {
			return value.length;
		}, "nested": {"raw": "source"}};
	}
	static fieldOverrideSummary(record: FieldOverrideRecord): string {
		let label: string | null = ((record.label ?? null) == null) ? "missing" : (record.label!);
		let tagCount: number = ((record.tags ?? null) == null) ? 0 : (record.tags!).length;
		let parsed: number = ((record.parse ?? null) == null) ? -1 : (record.parse!)("typed");
		let nested: string = ((record.nested ?? null) == null) ? "missing" : (record.nested!).raw;
		return label + ":" + tagCount + ":" + parsed + ":" + nested;
	}
	static tsOptionalRecord(): TsOptionalRecord {
		return {"label": "Grace", "tags": ["dto", "boundary"], "parse": function (value: string) {
			return value.length + 1;
		}, "nested": {"raw": "optional"}, "kind": "secondary"};
	}
	static tsOptionalFromNullable(label: string | null = null, tags: string[] | null = null, kind: "primary" | "secondary" | null = null): TsOptionalRecord {
		return {"label": (label ?? undefined), "tags": (tags ?? undefined), "kind": (kind ?? undefined)};
	}
	static tsOptionalCopy(record: TsOptionalRecord): TsOptionalRecord {
		return {"label": ((record.label ?? null) ?? undefined), "tags": ((record.tags ?? null) ?? undefined), "nested": ((record.nested ?? null) ?? undefined), "kind": ((record.kind ?? null) ?? undefined)};
	}
	static tsOptionalSummary(record: TsOptionalRecord): string {
		let label: string | null = ((record.label ?? null) == null) ? "missing" : (record.label!);
		let tagCount: number = ((record.tags ?? null) == null) ? 0 : (record.tags!).length;
		let parsed: number = ((record.parse ?? null) == null) ? -1 : (record.parse!)("typed");
		let nested: string = ((record.nested ?? null) == null) ? "missing" : (record.nested!).raw;
		let kind: string = ((record.kind ?? null) == null) ? "missing" : BoundaryTypes.optionalKindLabel((record.kind!));
		return label + ":" + tagCount + ":" + parsed + ":" + nested + ":" + kind;
	}
	static optionalKindLabel(kind: "primary" | "secondary"): string {
		return kind;
	}
	static normalize(value: MaybeName): string | null {
		return value ?? null;
	}
	static guardedName(value: string | null): MaybeName {
		if (value == null) {
			return undefined;
		};
		let present: string = value;
		return present;
	}
	static guardedUpper(value: string | null): string {
		if (value != null) {
			let present: string = value;
			return present.toUpperCase();
		};
		return "missing";
	}
	static guardedCall(value: string | null): string {
		if (value != null) {
			return BoundaryTypes.consumeName(value);
		};
		return "missing";
	}
	static record(value: unknown): UnknownMap {
		let out: {[key: string]: unknown} = {};
		out["payload"] = value;
		return out;
	}
	static narrowString(value: unknown): string | null {
		return UnknownNarrow.string(value);
	}
	static narrowBool(value: unknown): boolean | null {
		return UnknownNarrow.bool(value);
	}
	static narrowFinite(value: unknown): number | null {
		return UnknownNarrow.finiteNumber(value);
	}
	static narrowInt32(value: unknown): number | null {
		return UnknownNarrow.int32(value);
	}
	static narrowNativeError(value: unknown): Error | null {
		return UnknownNarrow.nativeError(value);
	}
	static decodeRecordSummary(value: unknown): string {
		let record: Readonly<Record<string, unknown>> | null = UnknownNarrow.record(value);
		if (record == null) {
			return "missing-record";
		};
		let name: string | null = UnknownNarrow.string(Object.prototype.hasOwnProperty.call(record, "name") ? record["name"] : undefined);
		let keys: string = (Object.keys(record)).join(",");
		let tmp: string = (Object.prototype.hasOwnProperty.call(record, "age")) ? "age" : "no-age";
		return ((name == null) ? "missing-name" : name) + ":" + tmp + ":" + keys;
	}
	static decodeArraySummary(value: unknown): string {
		let array: readonly unknown[] | null = UnknownNarrow.array(value);
		if (array == null) {
			return "missing-array";
		};
		let first: string | null | null = (array.length == 0) ? null : UnknownNarrow.string(array[0]);
		return ((first == null) ? "missing-first" : first) + ":" + ("" + array.length);
	}
	static copyOptionalItems(record: OptionalArrayRecord): string[] {
		if ((record.items ?? null) == null) {
			return [];
		} else {
			return (record.items!).slice();
		};
	}
	static joinOptionalItems(record: OptionalArrayRecord): string {
		let out: string[] = [];
		if ((record.items ?? null) != null) {
			let _g: number = 0;
			let _g1: string[] = (record.items!);
			while (_g < _g1.length) {
				let item: string = _g1[_g]!;
				++_g;
				out.push(item.toUpperCase());
			};
		};
		return out.join(",");
	}
	static guardedOptionalItemsCall(record: OptionalArrayRecord): string {
		if ((record.items ?? null) != null) {
			return BoundaryTypes.consumeItems((record.items!));
		};
		return "missing";
	}
	static labelOrFallback(record: OptionalNameRecord): string {
		if ((record.label ?? null) == null || (record.label ?? null) == "") {
			return "fallback";
		} else {
			return (record.label!);
		};
	}
	static nullableLabel(value: string | null): string {
		if (value == null) {
			return "missing";
		} else {
			return value;
		};
	}
	static consumeName(value: string): string {
		return value.toUpperCase();
	}
	static consumeItems(value: string[]): string {
		return value.join(",");
	}
	static optionalLabelViaNullableParam(record: OptionalNameRecord): string {
		return BoundaryTypes.nullableLabel((record.label ?? null));
	}
	static optionalNestedLabelViaNullableParam(record: OptionalNestedNameRecord): string {
		return BoundaryTypes.nullableLabel(((record.child!).label ?? null));
	}
	static nativeFunctionRecord(): NativeFunctionRecord {
		return {"function": {"name": "lookup", "arguments": "{}"}};
	}
	static nativeFunctionRecords(): NativeFunctionRecord[] {
		return [{"function": {"name": "array_lookup", "arguments": "{\"id\":1}"}}];
	}
	static nativeFunctionRecordsViaPush(): NativeFunctionRecord[] {
		let out: NativeFunctionRecord[] = [];
		out.push({"function": {"name": "push_lookup", "arguments": "{\"id\":2}"}});
		return out;
	}
	static nativeFunctionChoiceObject(): NativeFunctionChoice {
		return {"function": {"name": "choice_lookup", "arguments": "{\"id\":3}"}};
	}
	static nativeFunctionSummary(record: NativeFunctionRecord): string {
		return record["function"].name + ":" + record["function"]["arguments"];
	}
	static nativeOptionalRecord(): NativeOptionalRecord {
		return {"function": {"description": "typed native"}};
	}
	static nativeOptionalDescription(record: NativeOptionalRecord): string | null {
		return record["function"].description ?? null;
	}
	static nativeOptionalDescriptionPresent(record: NativeOptionalRecord): boolean {
		return (record["function"].description ?? null) != null;
	}
	static firstWarningFeature(record: OptionalWarningsRecord): string {
		return ((record.warnings ?? null)!)[0]!.feature;
	}
	static demo(): string {
		let present: string | null = BoundaryTypes.normalize(BoundaryTypes.presentName());
		let missing: string | null = BoundaryTypes.normalize(BoundaryTypes.missingName());
		let recordMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.missingRecord().name);
		let localMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.localMissingName());
		let chosenMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.chooseName(false));
		let assignedMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.assignMissingName().name);
		let assignedChosen: string | null = BoundaryTypes.normalize(BoundaryTypes.assignChosenName(false).name);
		let conditionalFlag: boolean | null = BoundaryTypes.conditionalFlagRecord(false).enabled ?? null;
		let bridgeFlag: boolean | null = BoundaryTypes.conditionalFlagBridge(false).enabled ?? null;
		let optionalMissing: string | null = BoundaryTypes.normalize(Register.unsafeCast<MaybeName>(BoundaryTypes.optionalMissingName().name));
		let optionalDirectMissing: string | null = BoundaryTypes.normalize(Register.unsafeCast<MaybeName>(BoundaryTypes.optionalDirectMissingName().name));
		let guardedPresent: string | null = BoundaryTypes.normalize(BoundaryTypes.guardedName("Ada"));
		let guardedMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.guardedName(null));
		let guardedUpper: string = BoundaryTypes.guardedUpper("ada");
		let guardedCallValue: string = BoundaryTypes.guardedCall("ada");
		let payload: UnknownMap = BoundaryTypes.record(BoundaryTypes.unknownValue("typed boundary"));
		let payloadStatus: string = (Object.prototype.hasOwnProperty.call(payload, "payload")) ? "payload" : "missing";
		let narrowedString: string | null = BoundaryTypes.narrowString(BoundaryTypes.unknownValue("typed"));
		let narrowedBool: boolean | null = BoundaryTypes.narrowBool(BoundaryTypes.unknownValue(true));
		let narrowedFinite: number | null = BoundaryTypes.narrowFinite(BoundaryTypes.unknownValue(12.5));
		let narrowedInt: number | null = BoundaryTypes.narrowInt32(BoundaryTypes.unknownValue(37));
		let narrowedNativeError: Error | null = BoundaryTypes.narrowNativeError(BoundaryTypes.unknownValue(new Error("native")));
		let narrowedRecord: string = BoundaryTypes.decodeRecordSummary(BoundaryTypes.unknownValue({"name": "Grace", "age": 37}));
		let narrowedArray: string = BoundaryTypes.decodeArraySummary(BoundaryTypes.unknownValue(["first", "second"]));
		let nullStatus: string = (((BoundaryTypes.unknownValue(null)) === null)) ? "null" : "not-null";
		let undefinedStatus: string = (((undefined) === undefined)) ? "undefined" : "defined";
		let optionalCopy: string = BoundaryTypes.copyOptionalItems({"items": ["a", "b"]}).join("");
		let optionalJoin: string = BoundaryTypes.joinOptionalItems({"items": ["c", "d"]});
		let optionalItemsCall: string = BoundaryTypes.guardedOptionalItemsCall({"items": ["e", "f"]});
		let optionalLabel: string = BoundaryTypes.labelOrFallback({"label": "typed"});
		let optionalParamLabel: string = BoundaryTypes.optionalLabelViaNullableParam({});
		let optionalNestedParamLabel: string = BoundaryTypes.optionalNestedLabelViaNullableParam({"child": {}});
		let nativeFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecord());
		let nativeArrayFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecords()[0]!);
		let nativePushFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecordsViaPush()[0]!);
		let nativeChoice: string = (BoundaryTypes.nativeFunctionChoiceObject() == null) ? "missing" : "choice";
		let nativeOptional: string | null = BoundaryTypes.nativeOptionalDescription(BoundaryTypes.nativeOptionalRecord());
		let nativeOptionalPresent: boolean = BoundaryTypes.nativeOptionalDescriptionPresent(BoundaryTypes.nativeOptionalRecord());
		let warningFeature: string = BoundaryTypes.firstWarningFeature({"warnings": [{"feature": "topK"}]});
		let fieldOverride: string = BoundaryTypes.fieldOverrideSummary(BoundaryTypes.fieldOverrideRecord());
		let tsOptional: string = BoundaryTypes.tsOptionalSummary(BoundaryTypes.tsOptionalRecord());
		let tsOptionalMissing: string = BoundaryTypes.tsOptionalSummary(BoundaryTypes.tsOptionalFromNullable());
		let tsOptionalCopied: string = BoundaryTypes.tsOptionalSummary(BoundaryTypes.tsOptionalCopy(BoundaryTypes.tsOptionalRecord()));
		return ((present == null) ? "none" : present) + ":" + ((missing == null) ? "none" : missing) + ":" + ((recordMissing == null) ? "none" : recordMissing) + ":" + ((localMissing == null) ? "none" : localMissing) + ":" + ((chosenMissing == null) ? "none" : chosenMissing) + ":" + ((assignedMissing == null) ? "none" : assignedMissing) + ":" + ((assignedChosen == null) ? "none" : assignedChosen) + ":" + ((conditionalFlag == null) ? "none" : (conditionalFlag) ? "true" : "false") + ":" + ((bridgeFlag == null) ? "none" : (bridgeFlag) ? "true" : "false") + ":" + ((optionalMissing == null) ? "none" : optionalMissing) + ":" + ((optionalDirectMissing == null) ? "none" : optionalDirectMissing) + ":" + ((guardedPresent == null) ? "none" : guardedPresent) + ":" + ((guardedMissing == null) ? "none" : guardedMissing) + ":" + guardedUpper + ":" + guardedCallValue + ":" + payloadStatus + ":" + ((narrowedString == null) ? "none" : narrowedString) + ":" + ((narrowedBool == null) ? "none" : (narrowedBool) ? "true" : "false") + ":" + ((narrowedFinite == null) ? "none" : "" + narrowedFinite) + ":" + ((narrowedInt == null) ? "none" : "" + narrowedInt) + ":" + ((narrowedNativeError == null) ? "none" : narrowedNativeError.message) + ":" + narrowedRecord + ":" + narrowedArray + ":" + nullStatus + ":" + undefinedStatus + ":" + optionalCopy + ":" + optionalJoin + ":" + optionalItemsCall + ":" + optionalLabel + ":" + optionalParamLabel + ":" + optionalNestedParamLabel + ":" + nativeFunction + ":" + nativeArrayFunction + ":" + nativePushFunction + ":" + nativeChoice + ":" + ((nativeOptional == null) ? "none" : nativeOptional) + ":" + ((nativeOptionalPresent) ? "present" : "missing") + ":" + warningFeature + ":" + fieldOverride + ":" + tsOptional + ":" + tsOptionalMissing + ":" + tsOptionalCopied;
	}
	static get __name__(): string {
		return "foo.BoundaryTypes"
	}
	get __class__(): Function {
		return BoundaryTypes
	}
}
Register.setHxClass("foo.BoundaryTypes", BoundaryTypes);
