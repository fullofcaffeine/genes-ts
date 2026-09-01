import {Register} from "../genes/Register.js"

type JsonPrimitive = null | boolean | number | string
type JsonObject = { readonly [key: string]: JsonValue }
type JsonArray = readonly JsonValue[]
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonNonNullValue = Exclude<JsonValue, null>

export type RecursiveJsonNode<T> = {
	next: RecursiveJsonNode<T> | null,
	value: T
}

export type AppliedRecursiveJsonNodes = {
	aPlain: RecursiveJsonNode<string>,
	zJson: RecursiveJsonNode<JsonPrimitive | JsonObject | JsonArray>
}

/**
 * Keeps differently applied recursive generic JSON types in one module.
 */
export class JsonDefinitionMemo {
	static recursive(input: AppliedRecursiveJsonNodes): AppliedRecursiveJsonNodes {
		return input;
	}
	static get __name__(): string {
		return "foo.JsonDefinitionMemo"
	}
	get __class__(): Function {
		return JsonDefinitionMemo
	}
}
Register.setHxClass("foo.JsonDefinitionMemo", JsonDefinitionMemo);
