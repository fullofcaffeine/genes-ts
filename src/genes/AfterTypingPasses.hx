package genes;

#if macro
import genes.incremental.GenerationChangeSet;
import genes.incremental.GenerationChangeSet.StampedDeclaration;
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

  /**
   * How this class arrived in the request, with the stamp that it carries
   * now. It is `null` unless the request uses the incremental path
   * (`-D genes.dev_incremental`, see `GenerationChangeSet`). A pass that
   * keeps a record between requests gives this value to the keep rule.
   */
  public final stamp: Null<StampedDeclaration>;

  var instanceFields: Null<Array<ClassField>> = null;
  var staticFields: Null<Array<ClassField>> = null;
  var constructorField: Null<ClassField> = null;
  var constructorRead = false;
  var bodies: Null<Map<String, Null<TypedExpr>>> = null;
  var members: Null<String> = null;

  public function new(type: ClassType, ?stamp: StampedDeclaration) {
    this.type = type;
    this.stamp = stamp;
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
   * Returns the member list of the class as one text: the names of the static
   * fields, of the instance fields, and whether the class has a constructor
   * and an `__init__` body. Example: `S:make,plain|I:value|C:1|N:0`.
   *
   * Why: Haxe can add a member to a class that it did not type again. The
   * first use of a `@:generic` method from another module adds one static
   * field for that use, for example `make_Int`. The stamp of the class does
   * not change then. A record of an earlier request is valid only for the
   * same member list (condition 6 of the keep rule).
   */
  public function memberList(): String {
    final known = members;
    if (known != null)
      return known;
    final text = 'S:'
      + [for (field in statics()) field.name].join(',') + '|I:' +
        [for (field in fields()) field.name].join(',')
        + '|C:'
        + (constructor() == null ? '0' : '1')
        + '|N:'
        + (type.init == null ? '0' : '1');
    members = text;
    return text;
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
 * The one `onAfterTyping` entry point of Genes. It runs the passes that read
 * every typed class before dead-code elimination in one walk, class by class,
 * and then the two captures of the generator.
 *
 * Why one walk: `genes.PublicSurface`, `genes.ts.SignatureCache` and
 * `genes.react.ReactDiagnosticsMacro` each registered an `onAfterTyping`
 * callback that read every class of the program. Each pass made the macro
 * interpreter copy every field body again. On an application with 1,100
 * modules these copies were about a third of the time that the passes use on
 * every request of a warm compiler server, also when no file changed.
 *
 * Why one entry point: a pass that keeps a record between requests must know,
 * before it reads a class, whether Haxe typed that class again. One owner,
 * `genes.incremental.GenerationChangeSet`, answers that with a stamp on each
 * declaration. The answer must exist before the first pass runs, and no
 * second callback may add stamps. Haxe 4.3.7 runs `onAfterTyping` callbacks
 * in reverse order of registration, so separate callbacks give an order that
 * depends on which `install()` ran first. One callback gives a fixed order.
 *
 * What: a pass gives `add` a function for one class. For each class of the
 * request, the walk makes one `AfterTypingClass` and calls every pass with it,
 * so all passes share one copy of the fields and bodies of that class. A pass
 * may also give a second function that receives the whole declaration list
 * after all classes; it reads the other declaration kinds there, and it can
 * rely on its class function having seen every class.
 *
 * Order, fixed, for each array that Haxe gives:
 *
 * 1. `GenerationChangeSet.observe`. Without `-D genes.dev_incremental` it
 *    returns at once and reads nothing.
 * 2. For each class, the passes in the order of their `add` calls
 *    (`PublicSurface`, `SignatureCache`, the React audit).
 * 3. The declaration functions of the passes.
 * 4. `ModuleDirectivePlan.capture`, when the generator installed it.
 * 5. `TypedModuleInventory.collect`, when the generator installed it.
 *
 * Steps 2 to 5 are the order that the separate callbacks had before. The
 * inventory stays last on purpose: a pass that asks the inventory during the
 * walk gets no answer and looks the module up by name, as before. Filling the
 * inventory first would change which answer such a pass gets, also in a build
 * that does not use the incremental path.
 *
 * Errors: the React audit is not the only pass that can report an error. The
 * declaration function of `PublicSurface` calls `LibraryProfile.retain`,
 * which can call `Context.error`. The audit runs before it, so the first
 * reported error is the same as before. A diagnostic of a class function
 * stops the compilation at the first class that has one; the steps after it
 * do not run, as before.
 *
 * Lifetime: the lists and flags are ordinary statics, not `@:persistent`.
 * Haxe replaces them at the start of each compilation on a compiler server,
 * and each `install()` of a pass adds its functions again. The walk keeps no
 * typed value after it returns.
 */
class AfterTypingPasses {
  static var registered = false;
  static var classPasses: Array<AfterTypingClass->Void> = [];
  static var declarationPasses: Array<Array<ModuleType>->Void> = [];

  /**
   * Registers the walk for the current compilation, once.
   *
   * `add` calls it. The generator also calls it through
   * `TypedModuleInventory.install()`, because the inventory and the module
   * directives must be captured in a build that adds no pass.
   */
  public static function register(): Void {
    if (registered)
      return;
    registered = true;
    Context.onAfterTyping(run);
  }

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
    register();
    classPasses.push(visitClass);
    if (visitDeclarations != null)
      declarationPasses.push(visitDeclarations);
  }

  static function run(types: Array<ModuleType>): Void {
    // `observed` is `null` unless this request uses the incremental path.
    // Then it holds, for each class, the copy of the class record that the
    // change set already read, so that the walk does not copy it again.
    final observed = GenerationChangeSet.observe(types);
    final walkStart = observed == null ? 0.0 : haxe.Timer.stamp();
    for (index => type in types) {
      switch type {
        case TClassDecl(reference):
          final seen = observed == null ? null : observed[index];
          final current = seen == null ? new AfterTypingClass(reference.get()) : new AfterTypingClass(seen.type,
            seen.stamp);
          if (current.stamp != null)
            GenerationChangeSet.readMembers(current.memberList);
          for (visit in classPasses)
            visit(current);
        default:
      }
    }
    for (visit in declarationPasses)
      visit(types);
    if (observed != null)
      GenerationChangeSet.finish(haxe.Timer.stamp() - walkStart);
    ModuleDirectivePlan.capture(types);
    TypedModuleInventory.collect(types);
  }
}
#end
