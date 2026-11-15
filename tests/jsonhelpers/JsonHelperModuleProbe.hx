package tests.jsonhelpers;

#if macro
import genes.JsonTypeSupport;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Compile-time check that each JSON helper module declares one abstract with
 * an empty body, and nothing else.
 *
 * Why: `JsonTypeQuery` in `src/genes/JsonTypeSupport.hx` decides from the
 * dotted path of a declaration whether it must read the declaration. Two
 * kinds of declaration have a path without the package of their module: a
 * type parameter of a method (`method.T`), and a class or enum that
 * `@:native` renames. The path check gives the wrong answer for those. It is
 * safe only while no JSON helper module has a method, a class, or an enum.
 *
 * This probe makes that condition a test. If a helper module needs a method
 * or another declaration, change the path check first, then this probe.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when the check fails.
 */
class JsonHelperModuleProbe {
  public static macro function validate(): Expr {
    // The same five modules as `JsonTypeSupport.isJsonTypeModule`.
    final helperModules = [
      "genes.ts.JsonValue",
      "genes.ts.JsonObject",
      "genes.ts.JsonArray",
      "genes.ts.JsonPrimitive",
      "genes.ts.JsonNonNullValue"
    ];
    for (module in helperModules) {
      require(JsonTypeSupport.isJsonTypeModule(module),
        '$module is in the probe list but is not a JSON helper module');
      var abstracts = 0;
      for (type in Context.getModule(module))
        switch type {
          case TAbstract(ref, _):
            abstracts++;
            final implementation = ref.get().impl;
            if (implementation != null)
              requireNoFields(module, implementation.get());
          case TInst(ref, _):
            final declaration = ref.get();
            require(declaration.kind.match(KAbstractImpl(_)),
              '$module declares the class ${declaration.name}');
            requireNoFields(module, declaration);
          case TEnum(ref, _):
            fail('$module declares the enum ${ref.get().name}');
          case TType(ref, _):
            fail('$module declares the typedef ${ref.get().name}');
          default:
            fail('$module declares an unexpected type');
        }
      require(abstracts == 1,
        '$module declares $abstracts abstracts; the path check expects one');
    }
    return macro null;
  }

  #if macro
  static function requireNoFields(module: String,
      declaration: ClassType): Void {
    final names = [
      for (field in declaration.statics.get().concat(declaration.fields.get()))
        field.name
    ];
    require(names.length == 0,
      '$module declares the fields ${names.join(", ")}. A method can have a ' +
      'type parameter, whose path does not contain the package of its module');
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      fail(message);
  }

  static function fail(message: String): Void {
    Context.fatalError("JSON helper module probe failed: "
      + message
      + ". See mayBeInJsonHelperModule in src/genes/JsonTypeSupport.hx",
      Context.currentPos());
  }
  #end
}
