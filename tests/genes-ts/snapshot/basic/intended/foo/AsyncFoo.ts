import {Register} from "../genes/Register.js"

export type AsyncOptionalLabelRecord = {
	label?: string | null
}

export class AsyncFoo extends Register.inherits() {
	constructor() {
		super();
	}
	[Register.new](...args: never[]): void;
	[Register.new](): void {
	}
	async plusOneAsync(x: number): Promise<number> {
		let v: number = await Promise.resolve(x);
		return v + 1;
	}
	async doubleWithAwaitMacro(x: number): Promise<number> {
		let v: number = await Promise.resolve(x);
		return v * 2;
	}
	async metadataAwaitLocalScope(x: number): Promise<number> {
		let pending: Promise<number> = Promise.resolve(x);
		let v: number = await pending;
		return v + 3;
	}
	async metadataAwaitOptionalParam(record: AsyncOptionalLabelRecord): Promise<string> {
		return await AsyncFoo.promiseLabel((record.label ?? null));
	}
	static promiseLabel(value: string | null): Promise<string> {
		return Promise.resolve((value == null) ? "missing" : value);
	}
	static demo(): Promise<number> {
		return new AsyncFoo().plusOneAsync(41);
	}
	static get __name__(): string {
		return "foo.AsyncFoo"
	}
	get __class__(): Function {
		return AsyncFoo
	}
}
Register.setHxClass("foo.AsyncFoo", AsyncFoo);
