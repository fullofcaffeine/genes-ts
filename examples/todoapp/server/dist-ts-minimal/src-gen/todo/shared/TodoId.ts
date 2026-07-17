import {Std} from "../../Std.js"
import {Register} from "../../genes/Register.js"

export class TodoId {
	static create(): string {
		let now: number = Date.now();
		let rnd: number = Std.random(2147483647);
		let this1: string = "" + (now | 0) + "-" + rnd;
		return this1;
	}
	static get __name__(): string {
		return "todo.shared._TodoId.TodoId_Impl_"
	}
	get __class__(): Function {
		return TodoId
	}
}
