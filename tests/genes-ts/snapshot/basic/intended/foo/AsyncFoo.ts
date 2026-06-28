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
		return await __AsyncFoo_promiseLabel((record.label ?? null));
	}
	static demo(): Promise<number> {
		return new AsyncFoo().plusOneAsync(41);
	}
	static demoPrivateStaticAsync(): Promise<number> {
		return __AsyncFoo_privateDoubleAsync(21);
	}
	static get __name__(): string {
		return "foo.AsyncFoo"
	}
	get __class__(): Function {
		return AsyncFoo
	}
}
function __AsyncFoo_promiseLabel(value: string | null): Promise<string> {
	return Promise.resolve((value == null) ? "missing" : value);
}
Register.unsafeCast<{promiseLabel: typeof __AsyncFoo_promiseLabel}>(AsyncFoo).promiseLabel = __AsyncFoo_promiseLabel;
async function __AsyncFoo_privateDoubleAsync(x: number): Promise<number> {
	let value: number = await Promise.resolve(x);
	return value * 2;
}
Register.unsafeCast<{privateDoubleAsync: typeof __AsyncFoo_privateDoubleAsync}>(AsyncFoo).privateDoubleAsync = __AsyncFoo_privateDoubleAsync;
Register.setHxClass("foo.AsyncFoo", AsyncFoo);
