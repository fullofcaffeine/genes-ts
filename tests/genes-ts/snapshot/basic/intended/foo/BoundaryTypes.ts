import {Register} from "../genes/Register.js"

export type UnknownRecord = {[key: string]: unknown}

export type MaybeName = string | undefined

export type MaybeNameRecord = {
	name: MaybeName
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
	static chooseName(present: boolean): MaybeName {
		if (present) {
			return "Ada";
		} else {
			return undefined;
		};
	}
	static normalize(value: MaybeName): string | null {
		return value ?? null;
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
		let chosenMissing: string | null = BoundaryTypes.normalize(BoundaryTypes.chooseName(false));
		let payload: UnknownRecord = BoundaryTypes.record(BoundaryTypes.unknownValue("typed boundary"));
		let payloadStatus: string = (Object.prototype.hasOwnProperty.call(payload, "payload")) ? "payload" : "missing";
		let optionalCopy: string = BoundaryTypes.copyOptionalItems({"items": ["a", "b"]}).join("");
		let optionalJoin: string = BoundaryTypes.joinOptionalItems({"items": ["c", "d"]});
		let optionalLabel: string = BoundaryTypes.labelOrFallback({"label": "typed"});
		return ((present == null) ? "none" : present) + ":" + ((missing == null) ? "none" : missing) + ":" + ((recordMissing == null) ? "none" : recordMissing) + ":" + ((chosenMissing == null) ? "none" : chosenMissing) + ":" + payloadStatus + ":" + optionalCopy + ":" + optionalJoin + ":" + optionalLabel;
	}
	static get __name__(): string {
		return "foo.BoundaryTypes"
	}
	get __class__(): Function {
		return BoundaryTypes
	}
}
Register.setHxClass("foo.BoundaryTypes", BoundaryTypes);
