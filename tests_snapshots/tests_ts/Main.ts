import {Register} from "./genes/Register.js"
import {Placeholder} from "./foo/Placeholder.js"
import {Foo} from "./foo/Foo.js"
import {AsyncFoo} from "./foo/AsyncFoo.js"

export class Main {
	static main(): void {
		let f: Foo = new Foo(1);
		console.log("tests_ts/src/Main.hx:8:",f.add(2));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests_ts/src/Main.hx:9:",v);
		});
		console.log("tests_ts/src/Main.hx:10:",Placeholder.demo());
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);
