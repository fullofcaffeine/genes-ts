import {Register} from "./genes/Register.js"
import {TypedCatch} from "./foo/TypedCatch.js"
import {ServerCallbacks} from "./foo/ServerCallbacks.js"
import {Placeholder} from "./foo/Placeholder.js"
import {Narrowing} from "./foo/Narrowing.js"
import {JsonAlias} from "./foo/JsonAlias.js"
import {Foo} from "./foo/Foo.js"
import {EnumAbstract} from "./foo/EnumAbstract.js"
import {BoundaryTypes} from "./foo/BoundaryTypes.js"
import {AsyncFoo} from "./foo/AsyncFoo.js"
import __genes_import_ThemeFixture from "./resources/theme.json" with { type: "json" }

type JsonPrimitive = null | boolean | number | string
type JsonObject = { readonly [key: string]: JsonValue }
type JsonArray = readonly JsonValue[]
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonNonNullValue = Exclude<JsonValue, null>

export type ThemeFixture = {
	accent: string,
	name: string
}

export class Main {
	declare static Theme: ThemeFixture;
	static main(): void {
		let f: Foo = new Foo(1);
		let asyncFoo: AsyncFoo = new AsyncFoo();
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:23:",f.add(2));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:24:",v);
		});
		asyncFoo.doubleWithAwaitMacro(21).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:25:",v);
		});
		asyncFoo.metadataAwaitLocalScope(39).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:26:",v);
		});
		asyncFoo.metadataAwaitOptionalParam({}).then(function (v: string) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:27:",v);
		});
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:28:",BoundaryTypes.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:29:",Placeholder.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:30:",new Date().getTime() > 0);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:31:",EnumAbstract.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:32:",EnumAbstract.localDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:33:",EnumAbstract.fieldLocalDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:34:",EnumAbstract.recordDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:35:",EnumAbstract.arrayLoopDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:36:",JsonAlias.passthrough({"metadata": null}).metadata);
		let server: {
			closeAllConnections: () => void,
			off: (event: string, handler: ((arg0: string) => void)) => void
		} = {"off": function (event: string, handler: ((arg0: string) => void)) {
			return;
		}, "closeAllConnections": function () {
			return;
		}};
		ServerCallbacks.callbackInitializedLater(server);
		ServerCallbacks.optionalForwardedMethod(server);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:43:",Narrowing.switchExitingNull({"value": "present"}));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:44:",TypedCatch.recover("fixture"));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:45:",TypedCatch.recover("plain"));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:46:",Main.Theme.name + ":" + Main.Theme.accent);
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
