package tests.referencetext;

#if macro
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.BindingIdentity.HaxeDeclarationKind;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Checks what `ref.toString()` returns for a declaration reference and for a
 * field reference in the Haxe macro interpreter.
 *
 * Why: `ref.get()` copies a complete declaration, so compiler code that runs
 * for every typed expression reads the text of the reference first
 * (`src/genes/AGENTS.md`). `NullishContract.classify`, `JsxPlan.markerKind`,
 * `TemplateLiteralPlan.isMarkerCallee`, and
 * `ExplicitTypeArguments.namesCallSiteCarrier` take the text as an exact
 * answer. Haxe does not document the text, so this probe pins it.
 *
 * What it checks:
 *
 * - For every class, enum, typedef, and abstract of this test program, the
 *   text equals `pack` and `name` joined with dots. The check runs twice:
 *   when typing ends, and again after generation. Between the two, Haxe's
 *   filter step renames a class that has `@:native`. Both forms must give
 *   the same answer at the same moment, also for a renamed class.
 * - For a static field, an instance field, and a closure of a method, the
 *   text of the field reference equals the field name.
 * - `HaxeDeclarationKey.tryFromBaseType` uses the text only to skip a
 *   declaration whose name differs. After generation, for every declaration,
 *   it must still find one of the same kind, module, and name. (A search that
 *   skipped too much returns no key, which the emitted code does not always
 *   show.)
 *
 * `test.hxml` installs this probe, so `yarn test` fails when a case fails.
 */
class ReferenceTextProbe {
  #if macro
  /** Installs the check. `test.hxml` calls it with `--macro`. */
  public static function install(): Void {
    checkFieldReferences();
    var afterTyping = 0;
    Context.onAfterTyping(types -> {
      for (type in types)
        switch type {
          case TClassDecl(ref):
            afterTyping += check('class', ref.toString(), ref.get());
          case TEnumDecl(ref):
            afterTyping += check('enum', ref.toString(), ref.get());
          case TTypeDecl(ref):
            afterTyping += check('typedef', ref.toString(), ref.get());
          case TAbstract(ref):
            afterTyping += check('abstract', ref.toString(), ref.get());
        }
    });
    // Haxe renames a `@:native` class after the `onGenerate` callbacks and
    // before the generator runs. The references are read again after
    // generation, where they show the renamed declarations.
    var generated: Array<Type> = [];
    Context.onGenerate(types -> generated = types);
    Context.onAfterGenerate(() -> {
      require(afterTyping > 100,
        'Probe setup: expected the declarations of the test program after typing');
      var checked = 0;
      var renamed = 0;
      for (type in generated)
        switch type {
          case TInst(ref, _):
            final declaration = ref.get();
            if (declaration.meta.has(':realPath'))
              renamed++;
            checked += check('class', ref.toString(), declaration);
          case TEnum(ref, _):
            checked += check('enum', ref.toString(), ref.get());
          case TType(ref, _):
            checked += check('typedef', ref.toString(), ref.get());
          case TAbstract(ref, _):
            checked += check('abstract', ref.toString(), ref.get());
          default:
        }
      require(checked > 100,
        'Probe setup: expected the declarations of the test program after generation');
      require(renamed > 0,
        'Probe setup: expected at least one class that Haxe renamed for @:native');
      checkDeclarationKeys(generated);
    });
  }

  /**
   * Requires that `HaxeDeclarationKey.tryFromBaseType` finds each generated
   * declaration: a key with the kind, module, and name of that declaration.
   */
  static function checkDeclarationKeys(types: Array<Type>): Void {
    var checked = 0;
    for (type in types) {
      final found = switch type {
        case TInst(ref, _):
          sameKey(ClassDecl, ref.get());
        case TEnum(ref, _):
          sameKey(EnumDecl, ref.get());
        case TType(ref, _):
          sameKey(TypedefDecl, ref.get());
        case TAbstract(ref, _):
          sameKey(AbstractDecl, ref.get());
        default:
          continue;
      }
      checked++;
      if (found != null)
        require(false, found);
    }
    require(checked > 100,
      'Probe setup: expected the declarations of the test program for tryFromBaseType');
  }

  /** Returns null when the search finds the key of `declaration`, else a message. */
  static function sameKey(kind: HaxeDeclarationKind,
      declaration: BaseType): Null<String> {
    final expected = new HaxeDeclarationKey(kind, declaration.module,
      declaration.name);
    final key = HaxeDeclarationKey.tryFromBaseType(declaration);
    return key != null
      && key.equals(expected) ? null : 'tryFromBaseType of '
        + expected.describe()
        + ' gave '
        + (key == null ? 'no key' : key.describe());
  }

  /** Requires that the text of one reference is `pack` and `name`. */
  static function check(kind: String, text: String,
      declaration: BaseType): Int {
    final expected = declaration.pack.concat([declaration.name]).join('.');
    require(text == expected,
      'The text of a $kind reference is "$text"; pack and name give "$expected" ' +
      '(module ${declaration.module})');
    return 1;
  }

  static function checkFieldReferences(): Void {
    final cases: Array<{expression: Expr, name: String}> = [
      {expression: macro StringTools.trim, name: 'trim'},
      {expression: macro haxe.io.Path.normalize, name: 'normalize'},
      {expression: macro "text".length, name: 'length'},
      {expression: macro "text".toUpperCase, name: 'toUpperCase'}
    ];
    var statics = 0;
    var instances = 0;
    var closures = 0;
    for (entry in cases) {
      switch Context.typeExpr(entry.expression).expr {
        case TField(_, FStatic(owner, field)):
          statics++;
          requireField(field.toString(), field.get().name, entry.name);
          check('class', owner.toString(), owner.get());
        case TField(_, FInstance(owner, _, field)):
          instances++;
          requireField(field.toString(), field.get().name, entry.name);
          check('class', owner.toString(), owner.get());
        case TField(_, FClosure(_, field)):
          closures++;
          requireField(field.toString(), field.get().name, entry.name);
        default:
          Context.fatalError('ReferenceText probe setup: "${entry.name}" is not a field access',
            Context.currentPos());
      }
    }
    require(statics == 2 && instances == 1 && closures == 1,
      'Probe setup: expected 2 static fields, 1 instance field, and 1 closure; ' +
      'found $statics, $instances, and $closures');
  }

  static function requireField(text: String, name: String,
      expected: String): Void {
    require(text == name && name == expected,
      'The text of a field reference is "$text"; the field name is "$name" ' +
      '(expected "$expected")');
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.fatalError('ReferenceText probe failed: ' + message,
        Context.currentPos());
  }
  #end
}
