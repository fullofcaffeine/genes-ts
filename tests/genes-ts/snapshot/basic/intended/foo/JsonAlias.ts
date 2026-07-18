import {Register} from "../genes/Register.js"

type JsonPrimitive = null | boolean | number | string
type JsonObject = { readonly [key: string]: JsonValue }
type JsonArray = readonly JsonValue[]
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonNonNullValue = Exclude<JsonValue, null>

export type JsonAliasEnvelope = {
	metadata: JsonPrimitive | JsonObject | JsonArray
}

/**
 * Snapshot fixture for aliases that reach `JsonValue` through a local abstract.
 */
export class JsonAlias {
	static passthrough(input: JsonAliasEnvelope): JsonAliasEnvelope {
		return input;
	}
	static get __name__(): string {
		return "foo.JsonAlias"
	}
	get __class__(): Function {
		return JsonAlias
	}
}
Register.setHxClass("foo.JsonAlias", JsonAlias);
