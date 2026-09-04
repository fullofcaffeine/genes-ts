package foo;

import genes.ts.JsonValue;

abstract MemoCycleJson(JsonValue) from JsonValue to JsonValue {}

typedef JsonCycleLeft = {
  final aRight: Null<JsonCycleRight>;
  final zPayload: MemoCycleJson;
}

typedef JsonCycleRight = {
  final aLeft: Null<JsonCycleLeft>;
}

/** Keeps JSON reachability visible after a mutually recursive cycle edge. */
class JsonDefinitionCycleMemo {
  public static function recursive(input: JsonCycleRight): JsonCycleRight {
    return input;
  }
}
