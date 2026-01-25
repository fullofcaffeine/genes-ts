import {Register} from "../genes/Register.js"

export class Foo extends Register.inherits() {
	constructor(x: number) {
		super(x);
	}
	declare x: number;
	[Register.new](...args: never[]): void;
	[Register.new](x: number): void {
		this.x = x;
	}
	add(y: number): number {
		return this.x + y;
	}
	static get __name__(): string {
		return "foo.Foo"
	}
	get __class__(): Function {
		return Foo
	}
}
Register.setHxClass("foo.Foo", Foo);

Register.seedProtoField(Foo, "x");
