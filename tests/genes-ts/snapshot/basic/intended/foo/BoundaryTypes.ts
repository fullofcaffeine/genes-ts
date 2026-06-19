import {Register} from "../genes/Register.js"

export type UnknownRecord = {[key: string]: unknown}

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
	static record(value: unknown): UnknownRecord {
		let out: {[key: string]: unknown} = {};
		out["payload"] = value;
		return out;
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
			while (_g < (_g1!).length) {
				let item: string = _g1[_g];
				++_g;
				out.push(item.toUpperCase());
			};
		};
		return out.join(",");
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
		let optionalMissing: string | null = BoundaryTypes.normalize(Register.unsafeCast<MaybeName>((BoundaryTypes.optionalMissingName().name ?? null)));
		let optionalDirectMissing: string | null = BoundaryTypes.normalize(Register.unsafeCast<MaybeName>((BoundaryTypes.optionalDirectMissingName().name ?? null)));
		let guardedPresent: string | null = BoundaryTypes.normalize(BoundaryTypes.guardedName("Ada"));
		let guardedMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.guardedName(null));
		let guardedUpper: string = BoundaryTypes.guardedUpper("ada");
		let payload: UnknownRecord = BoundaryTypes.record(BoundaryTypes.unknownValue("typed boundary"));
		let payloadStatus: string = (Object.prototype.hasOwnProperty.call(payload, "payload")) ? "payload" : "missing";
		let optionalCopy: string = BoundaryTypes.copyOptionalItems({"items": ["a", "b"]}).join("");
		let optionalJoin: string = BoundaryTypes.joinOptionalItems({"items": ["c", "d"]});
		let optionalLabel: string = BoundaryTypes.labelOrFallback({"label": "typed"});
		let optionalParamLabel: string = BoundaryTypes.optionalLabelViaNullableParam({});
		let optionalNestedParamLabel: string = BoundaryTypes.optionalNestedLabelViaNullableParam({"child": {}});
		let nativeFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecord());
		let nativeArrayFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecords()[0]);
		let nativePushFunction: string = BoundaryTypes.nativeFunctionSummary(BoundaryTypes.nativeFunctionRecordsViaPush()[0]);
		let nativeChoice: string = (BoundaryTypes.nativeFunctionChoiceObject() == null) ? "missing" : "choice";
		let nativeOptional: string | null = BoundaryTypes.nativeOptionalDescription(BoundaryTypes.nativeOptionalRecord());
		return ((present == null) ? "none" : present) + ":" + ((missing == null) ? "none" : missing) + ":" + ((recordMissing == null) ? "none" : recordMissing) + ":" + ((localMissing == null) ? "none" : localMissing) + ":" + ((chosenMissing == null) ? "none" : chosenMissing) + ":" + ((assignedMissing == null) ? "none" : assignedMissing) + ":" + ((assignedChosen == null) ? "none" : assignedChosen) + ":" + ((conditionalFlag == null) ? "none" : (conditionalFlag) ? "true" : "false") + ":" + ((bridgeFlag == null) ? "none" : (bridgeFlag) ? "true" : "false") + ":" + ((optionalMissing == null) ? "none" : optionalMissing) + ":" + ((optionalDirectMissing == null) ? "none" : optionalDirectMissing) + ":" + ((guardedPresent == null) ? "none" : guardedPresent) + ":" + ((guardedMissing == null) ? "none" : guardedMissing) + ":" + guardedUpper + ":" + payloadStatus + ":" + optionalCopy + ":" + optionalJoin + ":" + optionalLabel + ":" + optionalParamLabel + ":" + optionalNestedParamLabel + ":" + nativeFunction + ":" + nativeArrayFunction + ":" + nativePushFunction + ":" + nativeChoice + ":" + ((nativeOptional == null) ? "none" : nativeOptional);
	}
	static get __name__(): string {
		return "foo.BoundaryTypes"
	}
	get __class__(): Function {
		return BoundaryTypes
	}
}
Register.setHxClass("foo.BoundaryTypes", BoundaryTypes);
