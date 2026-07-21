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

/**
 * Host box whose field is intentionally broader than its Haxe type argument.
 *
 * Why: a JavaScript API may expose a plain string even when the surrounding
 * Haxe wrapper uses a closed domain. This is the negative control for the
 * emitter's generic-field provenance rule.
 *
 * What/How: `@:native("BroadBox")` binds this extern to the host's existing
 * ambient name, while `@:ts.type("string")` makes the field access broad in
 * generated TypeScript. Neither annotation emits a class or changes a runtime
 * value. When that value later enters a `Phase` slot, the compiler must retain
 * a local assertion rather than pretending the host declaration promised the
 * narrower union.
 */
@:native("BroadBox")
extern class BroadBox<Value> {
  @:ts.type("string")
  final value: Value;
}

/**
 * Exact global host boundary shared by the TypeScript and classic fixtures.
 *
 * Why: both output profiles need to call the same tiny JavaScript host without
 * introducing a package import that is unrelated to this type-flow test.
 *
 * What/How: `@:native("DomainHost")` binds static Haxe calls to the existing
 * global object declared by `ambient.d.ts` and installed by `runtime.mjs`.
 * Because this is an extern, Genes emits only the calls—no class or adapter.
 */
@:native("DomainHost")
extern class DomainHost {
  static function make<Value>(validValues: Array<Value>,
    initial: Value): HostState<Value>;
  static function broadBox(): BroadBox<Phase>;
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

  /**
   * Control showing why the emitter must remember the type it actually prints.
   *
   * This parameter intentionally exposes the broad host spelling `string`.
   * Passing it back to the closed Phase slot therefore still needs one local
   * TypeScript assertion; declaration provenance must not pretend the printed
   * parameter was the narrower literal union. The annotation changes only the
   * generated parameter type and creates no runtime conversion.
   */
  static function replaceFromBroadParameter(state: HostState<Phase>,
      @:ts.type("string") next: Phase): Void {
    state.replace(next);
  }

  static function model(): DomainModel {
    final state: HostState<Phase> = DomainHost.make([Phase.Draft, Phase.Published],
      Phase.Draft);
    final broadBox = DomainHost.broadBox();
    final select = function(next: Phase): Void {
      replaceFromMethod(state, next);
      replaceFromBroadParameter(state, next);
      state.replace(broadBox.value);
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
