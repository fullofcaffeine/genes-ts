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
	async plusOneAsync(x: number): globalThis.Promise<number> {
		const v: number = await globalThis.Promise.resolve(x);
		return v + 1;
	}
	async doubleWithAwaitMacro(x: number): globalThis.Promise<number> {
		const v: number = await globalThis.Promise.resolve(x);
		return v * 2;
	}
	async metadataAwaitLocalScope(x: number): globalThis.Promise<number> {
		let pending: globalThis.Promise<number> = globalThis.Promise.resolve(x);
		const v: number = await pending;
		return v + 3;
	}
	async metadataAwaitOptionalParam(record: AsyncOptionalLabelRecord): globalThis.Promise<string> {
		return await AsyncFoo.promiseLabel((record.label ?? null));
	}
	static promiseLabel(value: string | null): globalThis.Promise<string> {
		return globalThis.Promise.resolve((value == null) ? "missing" : value);
	}
	static demo(): globalThis.Promise<number> {
		return new AsyncFoo().plusOneAsync(41);
	}
	static demoPrivateStaticAsync(): globalThis.Promise<number> {
		return __AsyncFoo_privateDoubleAsync(21);
	}
	static get __name__(): string {
		return "foo.AsyncFoo"
	}
	get __class__(): Function {
		return AsyncFoo
	}
}
async function __AsyncFoo_privateDoubleAsync(x: number): globalThis.Promise<number> {
	const value: number = await globalThis.Promise.resolve(x);
	return value * 2;
}
Register.unsafeCast<{privateDoubleAsync: typeof __AsyncFoo_privateDoubleAsync}>(AsyncFoo).privateDoubleAsync = __AsyncFoo_privateDoubleAsync;
Register.setHxClass("foo.AsyncFoo", AsyncFoo);
