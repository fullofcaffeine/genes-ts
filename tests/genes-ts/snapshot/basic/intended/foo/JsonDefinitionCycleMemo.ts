import {Register} from "../genes/Register.js"

type JsonPrimitive = null | boolean | number | string
type JsonObject = { readonly [key: string]: JsonValue }
type JsonArray = readonly JsonValue[]
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonNonNullValue = Exclude<JsonValue, null>

export type JsonCycleLeft = {
	aRight: JsonCycleRight | null,
	zPayload: JsonPrimitive | JsonObject | JsonArray
}

export type JsonCycleRight = {
	aLeft: JsonCycleLeft | null
}

/**
 * Keeps JSON reachability visible after a mutually recursive cycle edge.
 */
export class JsonDefinitionCycleMemo {
	static recursive(input: JsonCycleRight): JsonCycleRight {
		return input;
	}
	static get __name__(): string {
		return "foo.JsonDefinitionCycleMemo"
	}
	get __class__(): Function {
		return JsonDefinitionCycleMemo
	}
}
Register.setHxClass("foo.JsonDefinitionCycleMemo", JsonDefinitionCycleMemo);
