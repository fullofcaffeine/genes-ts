import {Register} from "./genes/Register.js"
import __genes_import_PulseFile from "./resources/pulse.wav" with { type: "file" }
import __genes_import_PromptText from "./resources/prompt.txt"

export type ResourceModule = {
	default: string
}

export class Main {
	declare static Prompt: string;
	declare static Sound: string;
	static loadParser(): Promise<ResourceModule> {
		return import("./resources/parser.wasm" as string, { with: { type: "wasm" } });
	}
	static main(): void {
		console.log("tests/genes-ts/snapshot/resource-imports/src/Main.hx:17:",Main.Prompt.length + Main.Sound.length);
		Main.loadParser().then(function (module: ResourceModule) {
			console.log("tests/genes-ts/snapshot/resource-imports/src/Main.hx:18:",module["default"]);
		});
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);


Main.Prompt = __genes_import_PromptText
Main.Sound = __genes_import_PulseFile