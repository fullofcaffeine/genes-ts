import {Register} from "./genes/Register.js"
import {Placeholder} from "./foo/Placeholder.js"
import {Foo} from "./foo/Foo.js"
import {EnumAbstract} from "./foo/EnumAbstract.js"
import {BoundaryTypes} from "./foo/BoundaryTypes.js"
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
		let asyncFoo: AsyncFoo = new AsyncFoo();
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:19:",f.add(2));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:20:",v);
		});
		asyncFoo.doubleWithAwaitMacro(21).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:21:",v);
		});
		asyncFoo.metadataAwaitLocalScope(39).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:22:",v);
		});
		asyncFoo.metadataAwaitOptionalParam({}).then(function (v: string) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:23:",v);
		});
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:24:",BoundaryTypes.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:25:",Placeholder.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:26:",EnumAbstract.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:27:",Main.Theme.name + ":" + Main.Theme.accent);
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
