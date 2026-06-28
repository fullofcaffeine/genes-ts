import {Register} from "../genes/Register.js"

export type CacheLeaf = {
	cache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload"
}

export type CacheRecord = {
	cache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload",
	nested: CacheLeaf
}

export class EnumAbstract {
	declare static ClassField: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload";
	static accepts(v: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload"): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		return v;
	}
	static select(): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		return "no-cache";
	}
	static demo(): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		return EnumAbstract.accepts("default");
	}
	static localDemo(): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		let cache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" = EnumAbstract.select();
		return EnumAbstract.accepts(cache);
	}
	static fieldLocalDemo(): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		let cache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" = EnumAbstract.ClassField;
		return EnumAbstract.accepts(cache);
	}
	static recordValue(): CacheRecord {
		return {"cache": "force-cache", "nested": {"cache": "only-if-cached"}};
	}
	static recordDemo(): string {
		let records_0: CacheRecord = EnumAbstract.recordValue();
		let cache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" = records_0.cache;
		let nestedCache: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" = records_0.nested.cache;
		return EnumAbstract.accepts(EnumAbstract.ClassField) + ":" + EnumAbstract.accepts(cache) + ":" + EnumAbstract.accepts(nestedCache);
	}
	static arrayLoopDemo(): string {
		let count: number = 0;
		let cache: string = "default";
		EnumAbstract.accepts((cache as "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload"));
		++count;
		let cache1: string = "reload";
		EnumAbstract.accepts((cache1 as "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload"));
		++count;
		if (count == null) {
			return "null";
		} else {
			return "" + count;
		};
	}
	static get __name__(): string {
		return "foo.EnumAbstract"
	}
	get __class__(): Function {
		return EnumAbstract
	}
}
Register.setHxClass("foo.EnumAbstract", EnumAbstract);


EnumAbstract.ClassField = "reload"
