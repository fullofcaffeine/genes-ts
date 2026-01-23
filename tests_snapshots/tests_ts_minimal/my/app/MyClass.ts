import {Register} from "../../genes/Register.js"

export class MyClass extends (Register.inherits() as any) {
	constructor(value: number);
	constructor(...args: any[]) {
		super(...args);
	}
	declare value: number;
	[Register.new](value?: any): void {
		this.value = value;
	}
	static get __name__(): any {
		return "my.app.MyClass"
	}
	get __class__(): any {
		return MyClass
	}
}
MyClass.prototype.value = null as any;
