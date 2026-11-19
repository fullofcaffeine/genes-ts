package genes;

#if macro
import haxe.macro.Type;
import genes.incremental.ModuleFingerprint;

/**
 * The kinds of declaration that the reachability walk tells apart when it
 * reads the target of a dependency edge (`WalkTarget.inputsOf`).
 */
enum abstract StepTargetKind(String) to String {
  /** A class or an interface. */
  var ClassTarget = 'class';

  /** A class that stands for a type parameter; the walk takes no step to it. */
  var TypeParameterTarget = 'type-parameter';

  var EnumTarget = 'enum';
  var TypedefTarget = 'typedef';

  /** An abstract; it never owns an emitted member, so the walk takes no step to it. */
  var AbstractTarget = 'abstract';
}

/**
 * Every fact of the target of a dependency edge that the reachability walk
 * (`Generator.expandReachability`) reads before it takes a step, and the
 * metadata that the dependency plan of the visiting module reads.
 *
 * Why: the live walk decides from these facts alone (`takesStep`), and the
 * walk with stored edges of Stage 3, slice S2 records their text
 * (`inputsText`) for each step and compares it before it takes a stored step
 * (`IncrementalShadow.checkStoredTarget`). An after-typing macro can change
 * some of them without a new stamp. Example: `exclude()` on an enum makes it
 * extern, and `@:ts.type("string")` on a class removes the edges of modules
 * that name it only in a type position. Because the walk reads a target only
 * through `inputsOf`, a fact that the walk starts to read is a field here,
 * and so it is in the recorded text too. The common mistake this prevents:
 * a check that compares fewer facts than the walk reads, which keeps a stale
 * step.
 *
 * Not here: the step's second member name (`WalkStep.typeName`). The walk
 * reads it only while it takes the step, and the step records it or finds
 * the declaration again under a stamp check
 * (`IncrementalShadow.resolveStoredStep`).
 */
typedef StepInputs = {
  final kind: StepTargetKind;
  final isExtern: Bool;

  /** The module that owns the declaration; `null` or empty is an error of the walk. */
  final module: Null<String>;

  final name: String;

  /** The metadata, read as text only by `inputsText`. */
  final meta: MetaAccess;
}

/**
 * Returns the facts that the walk reads from the declaration `type`. It
 * reads nothing else, and changes nothing.
 */
function inputsOf(type: ModuleType): StepInputs {
  final base = DependencyPlan.moduleTypeBase(type);
  final kind = switch type {
    case TClassDecl(_.get() => {kind: KTypeParameter(_)}): TypeParameterTarget;
    case TClassDecl(_): ClassTarget;
    case TEnumDecl(_): EnumTarget;
    case TTypeDecl(_): TypedefTarget;
    case TAbstract(_): AbstractTarget;
  }
  return {
    kind: kind,
    isExtern: base.isExtern,
    module: base.module,
    name: base.name,
    meta: base.meta
  };
}

/**
 * Returns true when the walk takes a step to a target with these facts:
 * not an abstract or a type parameter, not extern, and not in `StdTypes`.
 * Example: an enum that a macro excluded is extern, so no step goes to it.
 */
function takesStep(inputs: StepInputs): Bool {
  return switch inputs.kind {
    case AbstractTarget | TypeParameterTarget: false;
    case ClassTarget | EnumTarget | TypedefTarget: !inputs.isExtern && inputs.module != 'StdTypes';
  }
}

/**
 * Returns the text of every field of `inputs`, the metadata as
 * `ModuleFingerprint.metaText`. Example:
 * `enum inc.ExclOwner.ExclEarly` for a plain enum, and
 * `enum extern inc.ExclOwner.ExclEarly` after `exclude()`. The walk records
 * this text for each step, and the walk with stored edges compares it.
 */
function inputsText(inputs: StepInputs): String {
  return '${inputs.kind}${inputs.isExtern ? ' extern' : ''} '
    + '${inputs.module}.${inputs.name}'
    + ModuleFingerprint.metaText(inputs.meta);
}
#end
