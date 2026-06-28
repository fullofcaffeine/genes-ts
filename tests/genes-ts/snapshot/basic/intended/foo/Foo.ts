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
		return __Foo_withPrivateOffset.call(this, y);
	}
	static normalize(value: string): string {
		return __Foo_privateNormalize(value);
	}
	static get __name__(): string {
		return "foo.Foo"
	}
	get __class__(): Function {
		return Foo
	}
}
function __Foo_withPrivateOffset(this: Foo, y: number): number {
	return this.x + y;
}
Register.unsafeCast<{withPrivateOffset: typeof __Foo_withPrivateOffset}>(Foo.prototype).withPrivateOffset = __Foo_withPrivateOffset;
function __Foo_privateNormalize(value: string): string {
	return value.toLowerCase();
}
Register.unsafeCast<{privateNormalize: typeof __Foo_privateNormalize}>(Foo).privateNormalize = __Foo_privateNormalize;
Register.setHxClass("foo.Foo", Foo);

Register.seedProtoField(Foo, "x");
