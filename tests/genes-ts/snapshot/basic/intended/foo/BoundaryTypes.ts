import {Register} from "../genes/Register.js"

export type UnknownRecord = {[key: string]: unknown}

export type MaybeName = string | undefined

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
	static normalize(value: MaybeName): string | null {
		return value ?? null;
	}
	static record(value: unknown): UnknownRecord {
		let out: {[key: string]: unknown} = {};
		out["payload"] = value;
		return out;
	}
	static demo(): string {
		let present: string | null = BoundaryTypes.normalize(BoundaryTypes.presentName());
		let missing: string | null = BoundaryTypes.normalize(BoundaryTypes.missingName());
		let payload: UnknownRecord = BoundaryTypes.record(BoundaryTypes.unknownValue("typed boundary"));
		let payloadStatus: string = (Object.prototype.hasOwnProperty.call(payload, "payload")) ? "payload" : "missing";
		return ((present == null) ? "none" : present) + ":" + ((missing == null) ? "none" : missing) + ":" + payloadStatus;
	}
	static get __name__(): string {
		return "foo.BoundaryTypes"
	}
	get __class__(): Function {
		return BoundaryTypes
	}
}
Register.setHxClass("foo.BoundaryTypes", BoundaryTypes);
