package tests.generationcaches;

#if macro
import genes.ExplicitTypeArguments.ExplicitTypeArgumentDeclarations;
import genes.util.TypeUtil;
import haxe.macro.Context;
import haxe.macro.Type;
#end

/**
 * Checks two answers that Genes keeps for one generation against the
 * computation that they replace.
 *
 * Why at macro time: both owners exist only in the macro interpreter, and a
 * wrong kept answer shows in generated code only for unusual programs. This
 * probe compares the kept answers directly, on the declarations as they are
 * after Haxe's filter step, where generation reads them.
 *
 * What it checks:
 *
 * - `TypeUtil.baseTypeName`: for every declaration of this test program, the
 *   answer after `TypeUtil.startGenerationNames()` (first call and call from
 *   the kept answers) equals the answer of the search without kept answers,
 *   and each kept answer is stored under its module path and its name.
 * - `ExplicitTypeArgumentDeclarations`: `NativeTwins` declares two extern
 *   classes that Haxe renames to one name, and two whose native names differ
 *   only in the package. After the rename each pair has one module and one
 *   name. Each class must still get its own annotated fields, in both read
 *   orders, and from the catalog itself (not from the fallback that reads
 *   the field list again). A type parameter gets no catalog answer.
 *
 * `test.hxml` installs this probe, so `yarn test` fails when a case fails.
 */
@:access(genes.util.TypeUtil)
@:access(genes.ExplicitTypeArgumentDeclarations)
class GenerationCachesProbe {
  #if macro
  static inline final TWINS = 'tests.generationcaches.NativeTwins';

  /** Installs the check. `test.hxml` calls it with `--macro`. */
  public static function install(): Void {
    // `-D genes.disable` runs the standard Haxe generator without Genes.
    if (Context.defined('genes.disable'))
      return;
    // Haxe renames a `@:native` class after the `onGenerate` callbacks and
    // before the generator runs. The check therefore runs after generation,
    // on the declarations as the generator saw them.
    var generated: Array<Type> = [];
    Context.onGenerate(types -> generated = types);
    Context.onAfterGenerate(() -> {
      checkBaseTypeNames(generated);
      checkCatalog(generated);
    });
  }

  static function checkBaseTypeNames(types: Array<Type>): Void {
    // Drop the answers of the generation that just ended, so that the first
    // pass below searches.
    TypeUtil.generationBaseTypeNames = null;
    final bases: Array<BaseType> = [];
    for (type in types) {
      final base = TypeUtil.typeToBaseType(type);
      if (base != null)
        bases.push(base);
    }
    require(bases.length > 100,
      'Probe setup: expected the declarations of the test program');
    final searched = [for (base in bases) TypeUtil.baseTypeName(base)];
    TypeUtil.startGenerationNames();
    for (index in 0...bases.length) {
      final base = bases[index];
      final first = TypeUtil.baseTypeName(base);
      final kept = TypeUtil.baseTypeName(base);
      require(first == searched[index] && kept == searched[index],
        'baseTypeName of ${base.module}.${base.name}: searched "${searched[index]}", ' +
        'first kept call "$first", second kept call "$kept"');
    }
    // The kept answers are stored by module path, then by name. A store
    // that ignored the module would pass the comparison above for every
    // program in which no two modules give one name two answers.
    final kept = TypeUtil.generationBaseTypeNames;
    require(kept != null, 'startGenerationNames did not start the answers');
    for (index in 0...bases.length) {
      final base = bases[index];
      final ofModule = kept.get(base.module);
      require(ofModule != null && ofModule.get(base.name) == searched[index],
        'The kept answer of ${base.module}.${base.name} is not stored under its ' +
        'module path and its name');
    }
    // Generation is over; the next request starts without kept answers.
    TypeUtil.generationBaseTypeNames = null;
  }

  static function checkCatalog(types: Array<Type>): Void {
    final twins: Array<ClassType> = [];
    var ordinary: Null<ClassType> = null;
    for (type in types) {
      switch type {
        case TInst(_.get() => cl, _):
          if (cl.module == TWINS)
            twins.push(cl);
          else if (cl.module == 'tests.Run' && cl.name == 'Run')
            ordinary = cl;
        default:
      }
    }
    require(twins.length == 4,
      'Probe setup: expected the 4 classes of $TWINS, found ${twins.length}');
    final plain = twinWith(twins, 'ProbeTwin', false);
    final annotated = twinWith(twins, 'ProbeTwin', true);
    final factoryPlain = twinWith(twins, 'Factory', false);
    final factoryAnnotated = twinWith(twins, 'Factory', true);

    for (order in [[plain, annotated], [annotated, plain]]) {
      final catalog = new ExplicitTypeArgumentDeclarations();
      for (owner in order) {
        final fields = catalog.fieldsOf(owner, true);
        require(fields != null,
          'The catalog gave no answer for a renamed class with @:realPath');
        final names = [for (field in fields) field.name].join(',');
        final expected = owner == annotated ? 'make,over' : '';
        require(names == expected,
          'Annotated fields of a native twin: "$names", expected "$expected" ' +
          '(first read: ${order[0] == annotated ? "annotated" : "plain"} class)');
      }
    }
    for (order in [[factoryPlain, factoryAnnotated], [factoryAnnotated, factoryPlain]]) {
      final catalog = new ExplicitTypeArgumentDeclarations();
      for (owner in order) {
        final fields = catalog.fieldsOf(owner, true);
        require(fields != null,
          'The catalog gave no answer for a renamed class with @:realPath');
        final names = [for (field in fields) field.name].join(',');
        final expected = owner == factoryAnnotated ? 'build' : '';
        require(names == expected,
          'Annotated fields of a package twin: "$names", expected "$expected"');
      }
    }

    final identities = [
      for (owner in twins)
        ExplicitTypeArgumentDeclarations.declarationIdentity(owner)
    ];
    for (left in 0...identities.length)
      for (right in left + 1...identities.length)
        require(identities[left] != null
          && identities[left] != identities[right],
          'Two classes of $TWINS share the catalog text "${identities[left]}"');

    // A type parameter is a class for Haxe; two can share a module and a name.
    final parameter = switch plain.statics.get()[0].params[0].t {
      case TInst(_.get() => cl, _): cl;
      default: null;
    }
    require(parameter != null && parameter.kind.match(KTypeParameter(_)),
      'Probe setup: expected the type parameter of TwinPlain.make');
    require(ExplicitTypeArgumentDeclarations.declarationIdentity(parameter) == null
      && new ExplicitTypeArgumentDeclarations().fieldsOf(parameter,
        true) == null,
      'A type parameter got a catalog answer');

    // A class without @:native has a text of its own kind.
    require(ordinary != null, 'Probe setup: tests.Run was not typed');
    final text = ExplicitTypeArgumentDeclarations.declarationIdentity(ordinary);
    require(text != null && identities.indexOf(text) == -1,
      'A class without @:native shares a catalog text with a renamed class');
  }

  /**
   * Returns the class of `NativeTwins` that Haxe renamed to `name` and that
   * has (or has not) an annotated field. Fails when the rename did not
   * happen: the probe would then not test the shared-name case.
   */
  static function twinWith(twins: Array<ClassType>, name: String,
      annotated: Bool): ClassType {
    for (twin in twins) {
      if (twin.name != name)
        continue;
      var has = false;
      for (field in twin.statics.get())
        if (field.meta.has(':ts.explicitTypeArguments'))
          has = true;
      if (has == annotated)
        return twin;
    }
    return
      Context.fatalError('GenerationCaches probe setup: no class of $TWINS has the name '
      + '$name after Haxe\'s filter step (annotated: $annotated)',
      Context.currentPos());
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.fatalError('GenerationCaches probe failed: ' + message,
        Context.currentPos());
  }
  #end
}
