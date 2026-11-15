package tests.signaturecache;

/** The closed value set that the probe looks for inside other types. */
enum abstract AnswerPhase(String) {
  var Draft = "draft";
  var Done = "done";
}

/**
 * `CycleA` and its two neighbours name each other; only `CycleA` holds the
 * phase. The probe must not depend on the order in which the compiler lists
 * declarations or record fields:
 *
 * - one neighbour is declared before `CycleA` and one after it, so the first
 *   declaration that the cache reads is a neighbour in either order;
 * - the phase field sorts between the two neighbour fields, so the walk of
 *   `CycleA` enters a neighbour before it finds the phase in either order.
 */
typedef CycleEarly = {
  final a: CycleA;
}

typedef CycleA = {
  final early: CycleEarly;
  final middle: AnswerPhase;
  final zone: CycleLate;
}

typedef CycleLate = {
  final a: CycleA;
}

/** A generic record whose answer depends only on its type argument. */
typedef AnswerBox<T> = {
  final value: T;
}

/** Generic aliases that Haxe follows straight to their type argument. */
typedef AnswerSameEarly<T> = T;

typedef AnswerSameLate<T> = T;

/**
 * A recursive record that reaches itself through the two aliases. As in
 * `CycleA`, the phase field sorts between them.
 */
typedef AnswerLoop = {
  final early: AnswerSameEarly<AnswerLoop>;
  final middle: AnswerPhase;
  final zone: AnswerSameLate<AnswerLoop>;
}

/**
 * A closed value set that has a literal TypeScript spelling in every output
 * profile.
 *
 * Why `@:ts.type`: this fixture compiles in the classic profile, where an
 * ordinary enum abstract prints as its underlying `string`. The metadata
 * replaces the printed type of `AnswerLevel` with the given text, so the
 * probe has a literal spelling to compare. It changes no runtime value.
 */
@:ts.type('"low" | "high"')
enum abstract AnswerLevel(String) {
  var Low = "low";
  var High = "high";
}

/**
 * Field types for `EnumAbstractAnswersProbe`. The field order is part of the
 * test: `genes.ts.SignatureCache` reads the fields in this order, and each
 * later field asks again about a declaration that an earlier field walked.
 */
@:keep
interface EnumAbstractAnswers {
  var cycleFirst: CycleA;
  var cycleEarly: CycleEarly;
  var cycleLate: CycleLate;
  var plainBox: AnswerBox<String>;
  var phaseBox: AnswerBox<AnswerPhase>;
  var loop: AnswerLoop;
  var plainSameEarly: AnswerSameEarly<String>;
  var plainSameLate: AnswerSameLate<String>;
  var plainText: String;
  var nullableLevel: Null<AnswerLevel>;
}
