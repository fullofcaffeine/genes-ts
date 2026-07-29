package genes;

import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Describes the type parameters that TypeScript must declare on one callable.
 *
 * Why:
 * A Haxe static method's final typed signature can contain a type parameter
 * that the method did not declare. This can be an enclosing class parameter,
 * or a parameter retained while Haxe infers the method through a generic call
 * site. TypeScript has no implicit generic scope for either case. In
 * particular, a generic class parameter belongs to the instance side and is
 * unavailable to a static member.
 *
 * What:
 * The plan finds every free `KTypeParameter` identity in a static callable's
 * signature, closes over parameters needed by their constraints, then appends
 * the method's declared parameters. Referenced owner parameters keep owner
 * declaration order; other inferred parameters keep first-use order. Each
 * entry receives a deterministic collision-safe TypeScript name. Parameter
 * identity is based on the Haxe compiler's declaration and source position,
 * never its source spelling alone.
 *
 * How:
 * `Module.fieldsOf` builds the plan from typed declarations before dependency
 * projection. TypeScript implementation and declaration emitters consume the
 * same immutable order and names. The expression body is deliberately not an
 * input: a parameter visible only in a static body gives callers no way to
 * bind it and requires a different representation or a diagnostic.
 *
 * This is a callable-only projection. Static properties cannot become generic
 * in TypeScript and therefore never receive free parameters from this plan.
 */
class CallableSignaturePlan {
  final parameterValues: Array<TypeParameter>;
  final names = new ObjectMap<ClassType, String>();
  final namesByStableIdentity: Map<String, String> = [];

  function new(parameters: Array<TypeParameter>) {
    parameterValues = parameters.copy();
    final counts: Map<String, Int> = [];
    for (parameter in parameterValues) {
      final declaration = typeParameterDeclaration(parameter.t);
      if (declaration == null)
        continue;
      final base = declaration.name;
      final count = counts.exists(base) ? counts.get(base) : 0;
      counts.set(base, count + 1);
      final emitted = count == 0 ? base : '${base}_$count';
      names.set(declaration, emitted);
      namesByStableIdentity.set(stableIdentity(declaration), emitted);
    }
  }

  /**
   * Builds a callable projection from the exact typed owner and member facts.
   *
   * Non-static callables retain only their declared method parameters. A
   * static callable first receives referenced free parameters, followed by its
   * method-local parameters. Exact identity deduplication keeps
   * abstract-implementation methods—whose existing field records may already
   * carry owner parameters—from declaring them twice.
   */
  public static function build(owner: ClassType, type: Type,
      declared: Array<TypeParameter>,
      projectFreeParameters: Bool): CallableSignaturePlan {
    final freeParameters: Array<TypeParameter> = [];
    if (projectFreeParameters) {
      final bound: Map<String, Bool> = [];
      for (parameter in declared) {
        final declaration = typeParameterDeclaration(parameter.t);
        if (declaration != null)
          bound.set(stableIdentity(declaration), true);
      }

      collectFreeParameters(type, bound, freeParameters);
      // A selected parameter's constraint can mention another free parameter,
      // so continue walking the growing list until its transitive closure is
      // complete. Exact-identity deduplication bounds the loop.
      var index = 0;
      while (index < freeParameters.length) {
        collectParameterConstraints(freeParameters[index], bound,
          freeParameters);
        index++;
      }
    }

    final parameters: Array<TypeParameter> = [];
    // Haxe owner declaration order is more stable and readable than whichever
    // part of a compound signature happened to mention an owner parameter
    // first.
    for (ownerParameter in owner.params)
      if (containsParameter(freeParameters, ownerParameter.t))
        parameters.push(ownerParameter);
    for (parameter in freeParameters)
      if (!containsParameter(parameters, parameter.t))
        parameters.push(parameter);
    for (parameter in declared)
      if (!containsParameter(parameters, parameter.t))
        parameters.push(parameter);
    return new CallableSignaturePlan(parameters);
  }

  /**
   * Combines overload plans for the one TypeScript implementation signature.
   *
   * Overload declarations keep independent generic scopes. Their shared body,
   * however, prints a union of all parameter and result types, so it needs one
   * collision-safe scope containing every exact parameter identity.
   */
  public static function merge(plans: Array<CallableSignaturePlan>): CallableSignaturePlan {
    final parameters: Array<TypeParameter> = [];
    for (plan in plans)
      for (parameter in plan.parameterValues)
        if (!containsParameter(parameters, parameter.t))
          parameters.push(parameter);
    return new CallableSignaturePlan(parameters);
  }

  /** Returns an immutable-copy view in declaration order. */
  public function parameters(): Array<TypeParameter> {
    return parameterValues.copy();
  }

  /** Returns the exact parameter types consumed by the shared type printer. */
  public function parameterTypes(): Array<Type> {
    return [for (parameter in parameterValues) parameter.t];
  }

  /** Whether this callable needs no TypeScript generic declaration. */
  public inline function isEmpty(): Bool {
    return parameterValues.length == 0;
  }

  /**
   * Resolves one Haxe parameter identity to its planned TypeScript spelling.
   *
   * Haxe can clone `KTypeParameter` refs while specializing a field type. The
   * exact declaration object is preferred; a source-stable
   * module/name/position identity joins those clones without confusing two
   * same-named parameters declared at different positions.
   */
  public function nameFor(parameter: ClassType): Null<String> {
    final exact = names.get(parameter);
    return
      exact != null ? exact : namesByStableIdentity.get(stableIdentity(parameter));
  }

  static function collectParameterConstraints(parameter: TypeParameter,
      bound: Map<String, Bool>, freeParameters: Array<TypeParameter>): Void {
    switch parameter.t {
      case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
        for (constraint in constraints)
          collectFreeParameters(constraint, bound, freeParameters);
      default:
    }
  }

  static function collectFreeParameters(type: Type, bound: Map<String, Bool>,
      freeParameters: Array<TypeParameter>,
      ?seenAnonymous: ObjectMap<Ref<AnonType>, Bool>, depth = 0): Void {
    if (depth > 64)
      return;
    if (seenAnonymous == null)
      seenAnonymous = new ObjectMap();
    switch type {
      case TInst(reference, parameters):
        final declaration = reference.get();
        if (declaration.kind.match(KTypeParameter(_))
          && !bound.exists(stableIdentity(declaration))
          && !containsParameter(freeParameters, type))
          freeParameters.push({
            name: declaration.name,
            t: type
          });
        for (parameter in parameters)
          collectFreeParameters(parameter, bound, freeParameters,
            seenAnonymous, depth + 1);
      case TEnum(_, parameters) | TType(_, parameters) |
        TAbstract(_, parameters):
        for (parameter in parameters)
          collectFreeParameters(parameter, bound, freeParameters,
            seenAnonymous, depth + 1);
      case TFun(arguments, result):
        for (argument in arguments)
          collectFreeParameters(argument.t, bound, freeParameters,
            seenAnonymous, depth + 1);
        collectFreeParameters(result, bound, freeParameters, seenAnonymous,
          depth + 1);
      case TAnonymous(reference):
        if (seenAnonymous.exists(reference))
          return;
        seenAnonymous.set(reference, true);
        for (field in reference.get().fields)
          collectFreeParameters(field.type, bound, freeParameters,
            seenAnonymous, depth + 1);
      case TDynamic(inner):
        if (inner != null)
          collectFreeParameters(inner, bound, freeParameters, seenAnonymous,
            depth + 1);
      case TMono(reference):
        final inner = reference.get();
        if (inner != null)
          collectFreeParameters(inner, bound, freeParameters, seenAnonymous,
            depth + 1);
      case TLazy(resolve):
        collectFreeParameters(resolve(), bound, freeParameters, seenAnonymous,
          depth + 1);
    }
  }

  static function containsParameter(parameters: Array<TypeParameter>,
      type: Type): Bool {
    final declaration = typeParameterDeclaration(type);
    return declaration != null
      && Lambda.exists(parameters,
        parameter -> switch typeParameterDeclaration(parameter.t) {
          case null: false;
          case candidate: candidate == declaration || stableIdentity(candidate) == stableIdentity(declaration);
        });
  }

  static function typeParameterDeclaration(type: Type): Null<ClassType> {
    return switch type {
      case TInst(reference, _):
        final declaration = reference.get();
        declaration.kind.match(KTypeParameter(_)) ? declaration : null;
      default:
        null;
    }
  }

  /**
   * Identifies cloned compiler declarations without falling back to a name.
   *
   * A generic class parameter `T` and a method-local parameter `T` have
   * different declaration positions, so they remain separate planned
   * parameters even when their readable names match.
   */
  static function stableIdentity(parameter: ClassType): String {
    final position = Context.getPosInfos(parameter.pos);
    return
      '${parameter.module}|${parameter.name}|${position.file}|${position.min}|${position.max}';
  }
}
