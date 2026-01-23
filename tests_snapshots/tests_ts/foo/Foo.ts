import {Register} from "../genes/Register.js"

export class Foo extends (Register.inherits() as any) {
	constructor(x: number);
	constructor(...args: any[]) {
		super(...args);
	}
	declare x: number;
	[Register.new](x?: any): void {
		this.x = x;
	}
	add(y: number): number {
		return this.x + y;
	}
	static get __name__(): any {
		return "foo.Foo"
	}
	get __class__(): any {
		return Foo
	}
}
(Register.global("$hxClasses") as any)["foo.Foo"] = Foo;

Foo.prototype.x = null as any;
