package tests.classicdts;

import genes.ts.JsonValue;

typedef ClassicRecursiveJsonNode<T> = {
  final value: T;
  final next: Null<ClassicRecursiveJsonNode<T>>;
}

typedef ClassicAppliedRecursiveJsonNodes = {
  final aPlain: ClassicRecursiveJsonNode<String>;
  final zJson: ClassicRecursiveJsonNode<JsonValue>;
}

/** Keeps applied recursive JSON types visible to classic declaration output. */
class RecursiveJsonDefinition {
  public static function preserve(input: ClassicAppliedRecursiveJsonNodes): ClassicAppliedRecursiveJsonNodes {
    return input;
  }
}
