package foo;

import genes.ts.JsonValue;

typedef RecursiveJsonStorage<T> = {
  final value: T;
  final next: Null<RecursiveJsonStorage<T>>;
}

abstract RecursiveJsonBox<T>(RecursiveJsonStorage<T>)
  from RecursiveJsonStorage<T> to RecursiveJsonStorage<T> {}

typedef AppliedRecursiveJsonBoxes = {
  final aPlain: RecursiveJsonBox<String>;
  final zJson: RecursiveJsonBox<JsonValue>;
}

/** Keeps differently applied generic abstracts visible to JSON detection. */
class JsonAbstractDefinitionMemo {
  public static function recursive(input: AppliedRecursiveJsonBoxes): String {
    final plain: RecursiveJsonStorage<String> = input.aPlain;
    return plain.value;
  }
}
