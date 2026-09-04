import {Register} from "../genes/Register.js"

type JsonPrimitive = null | boolean | number | string
type JsonObject = { readonly [key: string]: JsonValue }
type JsonArray = readonly JsonValue[]
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonNonNullValue = Exclude<JsonValue, null>

export type RecursiveJsonStorage<T> = {
	next: RecursiveJsonStorage<T> | null,
	value: T
}

export type AppliedRecursiveJsonBoxes = {
	aPlain: RecursiveJsonStorage<string>,
	zJson: RecursiveJsonStorage<JsonPrimitive | JsonObject | JsonArray>
}

/**
 * Keeps differently applied generic abstracts visible to JSON detection.
 */
export class JsonAbstractDefinitionMemo {
	static recursive(input: AppliedRecursiveJsonBoxes): string {
		const plain: RecursiveJsonStorage<string> = input.aPlain;
		return plain.value;
	}
	static get __name__(): string {
		return "foo.JsonAbstractDefinitionMemo"
	}
	get __class__(): Function {
		return JsonAbstractDefinitionMemo
	}
}
Register.setHxClass("foo.JsonAbstractDefinitionMemo", JsonAbstractDefinitionMemo);
