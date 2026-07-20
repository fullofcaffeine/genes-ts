/**
 * Closed phase values projected through the generic host tuple below.
 *
 * Why: Haxe retains `Phase` as a distinct authoring type, while an imported
 * generic needs its TypeScript argument to remain the exact literal union.
 * Without the override, Haxe's abstract erasure can make that argument print
 * as broad `string` even though the public fields still print as literals.
 *
 * What: `@:ts.type` projects every `Phase` occurrence to the two-value union.
 *
 * How: the annotation affects TypeScript types only. Values remain ordinary
 * strings in both TypeScript and classic JavaScript output.
 */
@:ts.type("'draft' | 'published'")
enum abstract Phase(String) to String {
  final Draft = "draft";
  final Published = "published";
}

/**
 * Zero-runtime view of a host-owned two-element tuple.
 *
 * Why: a homogeneous Haxe array would lose the distinct value/replacer types.
 *
 * What: `@:ts.type("[$0, (value: $0) => void]")` tells genes-ts to print the
 * generic argument in tuple slot zero and in slot one's function parameter.
 * `$0` means the first Haxe type parameter (`Value`); it is substitution syntax,
 * not emitted JavaScript.
 *
 * How: the `@:native("[0]")` and `[1]` fields lower reads to indexed access.
 * The extern has no constructor or runtime class in either output profile.
 */
@:ts.type("[$0, (value: $0) => void]")
extern class HostState<Value> {
  @:native("[0]")
  final value: Value;

  @:native("[1]")
  final replace: Value->Void;
}

/** Exact global host boundary shared by the TypeScript and classic fixtures. */
@:native("DomainHost")
extern class DomainHost {
  static function make<Value>(validValues: Array<Value>,
    initial: Value): HostState<Value>;
}

typedef DomainModel = {
  final phase: Phase;
  final select: Phase->Void;
}

/** Exercises exact nested-parameter and tuple-projection expression types. */
class Main {
  static function replaceFromMethod(state: HostState<Phase>, next: Phase): Void {
    state.replace(next);
  }

  static function model(): DomainModel {
    final state: HostState<Phase> = DomainHost.make([Phase.Draft, Phase.Published],
      Phase.Draft);
    final select = function(next: Phase): Void {
      replaceFromMethod(state, next);
    };
    return {
      phase: state.value,
      select: select
    };
  }

  static function main(): Void {
    final current = model();
    current.select(Phase.Published);
    trace(current.phase == Phase.Draft ? "projection-ok" : "projection-failed");
  }
}
