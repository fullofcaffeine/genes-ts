import {Register} from "../genes/Register.js"

export class AsyncFoo extends (Register.inherits() as any) {
	constructor();
	constructor(...args: any[]) {
		super(...args);
	}
	[Register.new](): void {
	}
	async plusOneAsync(x: number): Promise<number> {
		let v: number = await Promise.resolve(x);
		return v + 1;
	}
	static demo(): Promise<number> {
		return new AsyncFoo().plusOneAsync(41);
	}
	static get __name__(): any {
		return "foo.AsyncFoo"
	}
	get __class__(): any {
		return AsyncFoo
	}
}
(Register.global("$hxClasses") as any)["foo.AsyncFoo"] = AsyncFoo;
