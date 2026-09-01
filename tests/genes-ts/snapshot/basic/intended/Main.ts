import __genes_import_ThemeFixture from "./resources/theme.json" with { type: "json" }
import {Foo} from "./foo/Foo.js"
import {AsyncFoo} from "./foo/AsyncFoo.js"
import {BoundaryTypes} from "./foo/BoundaryTypes.js"
import {Placeholder} from "./foo/Placeholder.js"
import {EnumAbstract} from "./foo/EnumAbstract.js"
import {JsonAlias} from "./foo/JsonAlias.js"
import {JsonAbstractDefinitionMemo} from "./foo/JsonAbstractDefinitionMemo.js"
import {JsonDefinitionMemo} from "./foo/JsonDefinitionMemo.js"
import {JsonDefinitionCycleMemo} from "./foo/JsonDefinitionCycleMemo.js"
import {ServerCallbacks} from "./foo/ServerCallbacks.js"
import {Narrowing} from "./foo/Narrowing.js"
import {TypedCatch} from "./foo/TypedCatch.js"
import {ProjectedNullCall} from "./foo/ProjectedNullCall.js"
import {Register} from "./genes/Register.js"

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
		const f: Foo = new Foo(1);
		const asyncFoo: AsyncFoo = new AsyncFoo();
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:27:",f.add(2));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:28:",Foo.normalize("OK"));
		AsyncFoo.demo().then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:29:",v);
		});
		AsyncFoo.demoPrivateStaticAsync().then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:30:",v);
		});
		asyncFoo.doubleWithAwaitMacro(21).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:31:",v);
		});
		asyncFoo.metadataAwaitLocalScope(39).then(function (v: number) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:32:",v);
		});
		asyncFoo.metadataAwaitOptionalParam({}).then(function (v: string) {
			console.log("tests/genes-ts/snapshot/basic/src/Main.hx:33:",v);
		});
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:34:",BoundaryTypes.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:35:",Placeholder.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:36:",new Date().getTime() > 0);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:37:",EnumAbstract.demo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:38:",EnumAbstract.localDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:39:",EnumAbstract.fieldLocalDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:40:",EnumAbstract.recordDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:41:",EnumAbstract.arrayLoopDemo());
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:42:",JsonAlias.passthrough({"metadata": null}).metadata);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:43:",JsonAbstractDefinitionMemo.recursive({"aPlain": {"value": "plain", "next": null}, "zJson": {"value": null, "next": null}}));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:47:",JsonDefinitionMemo.recursive({"aPlain": {"value": "plain", "next": null}, "zJson": {"value": null, "next": null}}).aPlain.value);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:51:",(JsonDefinitionCycleMemo.recursive({"aLeft": {"aRight": null, "zPayload": null}}).aLeft!).zPayload);
		const server: {
			closeAllConnections: () => void,
			off: (event: string, handler: ((arg0: string) => void)) => void
		} = {"off": function (event: string, handler: ((arg0: string) => void)) {
			return;
		}, "closeAllConnections": function () {
			return;
		}};
		ServerCallbacks.callbackInitializedLater(server);
		ServerCallbacks.optionalForwardedMethod(server);
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:60:",Narrowing.switchExitingNull({"value": "present"}));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:61:",TypedCatch.recover("fixture"));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:62:",TypedCatch.recover("plain"));
		console.log("tests/genes-ts/snapshot/basic/src/Main.hx:63:",Main.Theme.name + ":" + Main.Theme.accent);
		ProjectedNullCall.demo(null);
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
