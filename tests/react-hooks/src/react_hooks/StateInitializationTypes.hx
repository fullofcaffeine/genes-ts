package react_hooks;

/** Shared state value accepted by both concrete structural subtypes. */
typedef Animal = {
  final name: String;
}

typedef Cat = {
  > Animal,
  final purr: Bool;
}

typedef Dog = {
  > Animal,
  final bark: Bool;
}

/** Generic enum whose left initializer does not determine `RightValue`. */
enum Choice<LeftValue, RightValue> {
  Left(value: LeftValue);
  Right(value: RightValue);
}
