package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * One class of the program, as the after-typing passes of one request read it.
 *
 * Why: a `ClassType` does not hold its fields and bodies as stored values. On
 * every `fields.get()` and every `ClassField.expr()` call the Haxe macro
 * interpreter copies the field list, or the complete typed expression tree of
 * a field, into new macro values. Three passes read every class, so one
 * request made every copy three times.
 *
 * What: this value makes each copy for the first pass that asks and returns
 * the same value to the next pass. The values are the ones that a direct call
 * returns at that point. The passes only read them.
 *
 * Lifetime: `AfterTypingPasses` makes one value for one class, gives it to
 * every pass, and then drops it before it reads the next class. No copy
 * outlives its class, so nothing passes to a later request, and the copies do
 * not stay in memory while the other classes are read.
 */
class AfterTypingClass {
  /** The class record that Haxe typed. */
  public final type: ClassType;

  /**
   * The full owner name that the passes use as the class key. A type whose
   * name differs from its module keeps both parts, for example
   * `app.Models.User`.
   */
  public final ownerKey: String;

  var instanceFields: Null<Array<ClassField>> = null;
  var staticFields: Null<Array<ClassField>> = null;
  var constructorField: Null<ClassField> = null;
  var constructorRead = false;
  var bodies: Null<Map<String, Null<TypedExpr>>> = null;

  public function new(type: ClassType) {
    this.type = type;
    final declaredPath = type.pack.concat([type.name]).join('.');
    this.ownerKey = declaredPath == type.module ? declaredPath : type.module
      + '.'
      + type.name;
  }

  /** Returns the instance fields in declaration order. Do not change the array. */
  public function fields(): Array<ClassField> {
    final known = instanceFields;
    if (known != null)
      return known;
    return instanceFields = type.fields.get();
  }

  /** Returns the static fields in declaration order. Do not change the array. */
  public function statics(): Array<ClassField> {
    final known = staticFields;
    if (known != null)
      return known;
    return staticFields = type.statics.get();
  }

  /** Returns the constructor, or `null` when the class declares none. */
  public function constructor(): Null<ClassField> {
    if (!constructorRead) {
      constructorRead = true;
      final reference = type.constructor;
      constructorField = reference == null ? null : reference.get();
    }
    return constructorField;
  }

  /**
   * Returns the typed body of `field`, or `null` when the field has no body.
   *
   * `field` must come from `fields()`, `statics()` or `constructor()` of this
   * class; pass `false` for `isStatic` for the constructor. The static flag
   * and the field name are an exact identity inside one class, because Haxe
   * does not permit two fields with one name. An overload signature shares the
   * name of its field: read it with `signature.expr()` instead.
   */
  public function body(field: ClassField, isStatic: Bool): Null<TypedExpr> {
    var known = bodies;
    if (known == null)
      known = bodies = new Map();
    final key = (isStatic ? 'S:' : 'I:') + field.name;
    if (known.exists(key))
      return known.get(key);
    final body = field.expr();
    known.set(key, body);
    return body;
  }
}

/**
 * Runs the passes that read every typed class before dead-code elimination in
 * one walk, class by class.
 *
 * Why: `genes.PublicSurface`, `genes.ts.SignatureCache` and
 * `genes.react.ReactDiagnosticsMacro` each registered an `onAfterTyping`
 * callback that read every class of the program. Each pass made the macro
 * interpreter copy every field body again. On an application with 1,100
 * modules these copies were about a third of the time that the passes use on
 * every request of a warm compiler server, also when no file changed.
 *
 * What: a pass gives `add` a function for one class. For each class of the
 * request, the walk makes one `AfterTypingClass` and calls every pass with it,
 * so all passes share one copy of the fields and bodies of that class. A pass
 * may also give a second function that receives the whole declaration list
 * after all classes; it reads the other declaration kinds there, and it can
 * rely on its class function having seen every class.
 *
 * Order: for one class, the passes run in the order of their `add` calls.
 * Haxe 4.3.7 runs `onAfterTyping` callbacks in reverse order of registration.
 * Before this walk, the order was: the React audit over the whole program,
 * then `SignatureCache`, then `PublicSurface`, then `ModuleDirectivePlan`.
 * Now it is: this walk for each class (`PublicSurface`, `SignatureCache`, the
 * React audit), then the declaration functions, then `ModuleDirectivePlan`.
 * This changes no result. No pass reads a fact of another pass during the
 * walk. The class functions of `PublicSurface` and `SignatureCache` raise no
 * errors, and the audit adds no metadata.
 *
 * Errors: the React audit is not the only pass that can report an error. The
 * declaration function of `PublicSurface` calls `LibraryProfile.retain`,
 * which can call `Context.error`. The audit runs before it in the old order
 * and in the new order, so the first reported error is the same. A diagnostic
 * of a class function stops the compilation at the first class that has one,
 * as before.
 *
 * Lifetime: the lists are ordinary statics, not `@:persistent`. Haxe replaces
 * them at the start of each compilation on a compiler server, and each
 * `install()` of a pass adds its functions again. The walk keeps no typed
 * value after it returns.
 */
class AfterTypingPasses {
  static var classPasses: Array<AfterTypingClass->Void> = [];
  static var declarationPasses: Array<Array<ModuleType>->Void> = [];

  /**
   * Adds one pass for the current compilation.
   *
   * `visitClass` runs once for each typed class. `visitDeclarations`, when
   * given, runs once after all classes with the complete list that Haxe gave
   * to `onAfterTyping`. Haxe can call `onAfterTyping` again when a callback
   * defines new types; the walk then reads only those new declarations.
   */
  public static function add(visitClass: AfterTypingClass->Void,
      ?visitDeclarations: Array<ModuleType>->Void): Void {
    if (classPasses.length == 0)
      Context.onAfterTyping(run);
    classPasses.push(visitClass);
    if (visitDeclarations != null)
      declarationPasses.push(visitDeclarations);
  }

  static function run(types: Array<ModuleType>): Void {
    for (type in types) {
      switch type {
        case TClassDecl(reference):
          final current = new AfterTypingClass(reference.get());
          for (visit in classPasses)
            visit(current);
        default:
      }
    }
    for (visit in declarationPasses)
      visit(types);
  }
}
#end
