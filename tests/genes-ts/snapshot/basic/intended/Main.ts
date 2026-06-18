import {Register} from "./genes/Register.js"
import {Placeholder} from "./foo/Placeholder.js"
import {Foo} from "./foo/Foo.js"
import {EnumAbstract} from "./foo/EnumAbstract.js"
import {AsyncFoo} from "./foo/AsyncFoo.js"
import __genes_import_ThemeFixture from "./resources/theme.json" with { type: "json" }

export type ThemeFixture = {
	accent: string,
	name: string
}

export class Main {
	declare static Theme: ThemeFixture;
	static main(): void {
		let f: Foo = new Foo(1);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:17:",f.add(2));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:18:",v);
		});
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:19:",Placeholder.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:20:",EnumAbstract.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:21:",Main.Theme.name + ":" + Main.Theme.accent);
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);


Main.Theme = __genes_import_ThemeFixture
