import {Register} from "./genes/Register.js"
import {Foo} from "./foo/Foo.js"
import {AsyncFoo} from "./foo/AsyncFoo.js"

export class Main {
	static main(): void {
		let f: Foo = new Foo(1);
		console.log("tests_ts/src/Main.hx:7:",f.add(2));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests_ts/src/Main.hx:8:",v);
		});
	}
	static get __name__(): any {
		return "Main"
	}
	get __class__(): any {
		return Main
	}
}
(Register.global("$hxClasses") as any)["Main"] = Main;
