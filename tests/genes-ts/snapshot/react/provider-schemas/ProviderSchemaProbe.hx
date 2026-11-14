#if macro
import genes.JsxTypeChecker;
import genes.JsxTypeChecker.JsxProviderSchemaCatalog;
import genes.Module;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.TypeTools;

/**
 * Proves when two HXX checkers of one output generation share a schema.
 *
 * Why: every module that contains HXX creates its own `JsxTypeChecker`. One
 * generation may keep a validated provider schema in a
 * `JsxProviderSchemaCatalog` and give it to the next checker. That is only
 * correct while the shared schema equals the one a new build would produce.
 * This probe builds real plans for two modules and changes the provider
 * between them, the way a later compiler step could.
 *
 * What it checks, with no extra define:
 *
 * - a closed typedef is built once and the second checker receives the same
 *   schema object;
 * - a typedef that still holds an inference variable is never shared;
 * - a checker without a catalog shares nothing;
 * - one typedef under two optional-value policies keeps two schemas; and
 * - both module plans pass.
 *
 * `-D probe_rename` renames the closed tag after the first plan. The second
 * module still writes the old name and must fail with `GTS-HXX-TAG-001`.
 *
 * `-D probe_poison` makes the unused open typedef weak after the first plan.
 * No module uses that tag, but the second plan must still fail with
 * `GTS-HXX-SCHEMA-008`, because every checker validates every declaration.
 *
 * Both mutations are fault injection at the compiler boundary. They do not
 * claim that an ordinary application makes these changes.
 */
@:access(genes.JsxTypeChecker)
class ProviderSchemaProbe {
  public static function install(): Void {
    final first = Context.getType("ProviderSchemaFirst");
    final second = Context.getType("ProviderSchemaSecond");
    final provider = Context.getType("ProviderSchemaElements");
    Context.onGenerate(_ -> {
      checkSharing();
      final context: ModuleContext = {
        modules: new Map<String, Module>(),
        concrete: new Array<String>(),
        hasFeature: (_: String) -> false,
        jsxProviderSchemas: new JsxProviderSchemaCatalog()
      };
      final firstModule = new Module(context, "ProviderSchemaFirst", [first]);
      if (!firstModule.jsxPlan.hasIntents)
        throw "The first module must contain a validated HXX intent";
      Sys.println("Provider schema probe: first module plan passed");
      if (Context.defined("probe_rename"))
        renameClosedTag(provider);
      if (Context.defined("probe_poison"))
        poisonUnusedTag(provider);
      final secondModule = new Module(context, "ProviderSchemaSecond",
        [second]);
      if (!secondModule.jsxPlan.hasIntents)
        throw "The second module must contain a validated HXX intent";
      Sys.println("Provider schema probe: second module plan passed");
    });
  }

  /** Compares the schemas that two checkers hold for the same tags. */
  static function checkSharing(): Void {
    final catalog = new JsxProviderSchemaCatalog();
    final one = new JsxTypeChecker(catalog);
    final two = new JsxTypeChecker(catalog);
    if (one.intrinsics.get("x-closed")
      .schema != two.intrinsics.get("x-closed")
      .schema)
      throw "A closed typedef must be validated once per generation";
    Sys.println("Provider schema probe: closed typedef shared");
    if (one.intrinsics.get("x-open")
      .schema == two.intrinsics.get("x-open")
      .schema)
      throw "A typedef with an inference variable must not be shared";
    Sys.println("Provider schema probe: open typedef rebuilt");
    final alone = new JsxTypeChecker();
    if (alone.intrinsics.get("x-closed")
      .schema == one.intrinsics.get("x-closed")
      .schema)
      throw "A checker without a catalog must build its own schemas";
    Sys.println("Provider schema probe: no catalog, nothing shared");
    final plain = hintType(one.intrinsics.get("x-closed").schema.fields);
    final policy = hintType(one.intrinsics.get("x-policy").schema.fields);
    if (plain != "Null<String>" || policy != "String")
      throw 'Optional-value policy must keep its own schema; received $plain and $policy';
    Sys.println("Provider schema probe: policy schema kept separate");
  }

  static function hintType(fields: Map<String, {type: Type}>): String {
    final hint = fields.get("hint");
    if (hint == null)
      throw "Expected the optional `hint` property";
    return TypeTools.toString(hint.type);
  }

  /** Renames `x-closed` in the provider metadata, as a macro could. */
  static function renameClosedTag(provider: Type): Void {
    final field = providerField(provider, "closed");
    field.meta.remove(":genes.jsxIntrinsic");
    field.meta.add(":genes.jsxIntrinsic", [macro "x-renamed"], field.pos);
    Sys.println("Provider schema probe: closed tag renamed");
  }

  /**
   * Binds the unused tag's open element type to `Array<Dynamic>`.
   *
   * The mutation uses real unification, so it is the same kind of change
   * that HXX validation makes when it binds an inference variable.
   */
  static function poisonUnusedTag(provider: Type): Void {
    final field = providerField(provider, "unused");
    final fields = switch Context.follow(field.type) {
      case TAnonymous(reference): reference.get().fields;
      default: throw "Expected the open props structure";
    };
    for (property in fields) {
      if (property.name != "values")
        continue;
      final weak = switch Context.getType("Array") {
        // A deliberate weak value for the negative case only.
        case TInst(reference, _):
          TInst(reference, [TInst(reference, [TDynamic(null)])]);
        default: throw "Expected the Array class";
      };
      if (!Context.unify(property.type, weak))
        throw "The open type must accept the injected weak type";
      if (!JsxTypeChecker.isUnsafeSchema(property.type))
        throw "The injected type must make the schema unsafe";
      Sys.println("Provider schema probe: unused tag made weak");
      return;
    }
    throw "The unused tag has no `values` property";
  }

  static function providerField(provider: Type, name: String): ClassField {
    final owner = switch provider {
      case TInst(reference, _): reference.get();
      default: throw "Expected a provider class";
    };
    for (field in owner.statics.get())
      if (field.name == name)
        return field;
    throw 'Provider has no static field `$name`';
  }
}
#else
class ProviderSchemaProbe {}
#end
