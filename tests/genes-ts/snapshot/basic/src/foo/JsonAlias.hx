package foo;

import genes.ts.JsonValue;

/**
 * Downstream domain name over native JSON.
 *
 * This mirrors products that want a semantic JSON wrapper while keeping the
 * generated TypeScript surface as the recursive `JsonValue` alias family.
 */
abstract MetadataJson(JsonValue) from JsonValue to JsonValue {}

typedef JsonAliasEnvelope = {
	final metadata:MetadataJson;
}

/**
 * Snapshot fixture for aliases that reach `JsonValue` through a local abstract.
 */
class JsonAlias {
	public static function passthrough(input:JsonAliasEnvelope):JsonAliasEnvelope {
		return input;
	}
}
