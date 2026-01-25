import {Register} from "../../genes/Register.js"

export class MyClass extends Register.inherits() {
	constructor(value: number) {
		super(value);
	}
	declare value: number;
	[Register.new](...args: never[]): void;
	[Register.new](value: number): void {
		this.value = value;
	}
	static get __name__(): string {
		return "my.app.MyClass"
	}
	get __class__(): Function {
		return MyClass
	}
}
Register.seedProtoField(MyClass, "value");
