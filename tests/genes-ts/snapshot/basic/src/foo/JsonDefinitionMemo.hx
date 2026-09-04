package foo;

import genes.ts.JsonValue;

abstract MemoJson(JsonValue) from JsonValue to JsonValue {}

typedef RecursiveJsonNode<T> = {
  final value: T;
  final next: Null<RecursiveJsonNode<T>>;
}

typedef AppliedRecursiveJsonNodes = {
  final aPlain: RecursiveJsonNode<String>;
  final zJson: RecursiveJsonNode<MemoJson>;
}

/** Keeps differently applied recursive generic JSON types in one module. */
class JsonDefinitionMemo {
  public static function recursive(input: AppliedRecursiveJsonNodes): AppliedRecursiveJsonNodes {
    return input;
  }
}
