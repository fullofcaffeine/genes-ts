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

export type OptionalArrayRecord = {
	items?: string[] | null
}

export type OptionalNameRecord = {
	label?: string | null
}

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
	static demo(): string {
		let present: string | null = BoundaryTypes.normalize(BoundaryTypes.presentName());
		let missing: string | null = BoundaryTypes.normalize(BoundaryTypes.missingName());
		let recordMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.missingRecord().name);
		let localMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.localMissingName());
		let chosenMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.chooseName(false));
		let assignedMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.assignMissingName().name);
		let assignedChosen: string | null = BoundaryTypes.normalize(BoundaryTypes.assignChosenName(false).name);
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
		return ((present == null) ? "none" : present) + ":" + ((missing == null) ? "none" : missing) + ":" + ((recordMissing == null) ? "none" : recordMissing) + ":" + ((localMissing == null) ? "none" : localMissing) + ":" + ((chosenMissing == null) ? "none" : chosenMissing) + ":" + ((assignedMissing == null) ? "none" : assignedMissing) + ":" + ((assignedChosen == null) ? "none" : assignedChosen) + ":" + ((optionalMissing == null) ? "none" : optionalMissing) + ":" + ((optionalDirectMissing == null) ? "none" : optionalDirectMissing) + ":" + ((guardedPresent == null) ? "none" : guardedPresent) + ":" + ((guardedMissing == null) ? "none" : guardedMissing) + ":" + guardedUpper + ":" + payloadStatus + ":" + optionalCopy + ":" + optionalJoin + ":" + optionalLabel;
	}
	static get __name__(): string {
		return "foo.BoundaryTypes"
	}
	get __class__(): Function {
		return BoundaryTypes
	}
}
Register.setHxClass("foo.BoundaryTypes", BoundaryTypes);
