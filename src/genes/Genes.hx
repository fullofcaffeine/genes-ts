package genes;

#if macro
import haxe.macro.Expr;
import haxe.macro.Context;
import haxe.macro.Compiler;
import haxe.macro.Type.TypedExpr;
import haxe.io.Path;
import genes.util.PathUtil;
import genes.util.TypeUtil;
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.DynamicImportBindingPlan;

using haxe.macro.TypeTools;
using haxe.macro.TypedExprTools;
using Lambda;

private typedef ImportedModule = {
  name: String,
  importType: String,
  importExpr: Expr,
  types: Array<{
    localName: String,
    exportName: String,
    fullname: String,
    key: HaxeDeclarationKey,
    type: haxe.macro.Type
  }>,
  directFunctions: Array<{
    name: String,
    ownerModule: String,
    ownerName: String,
    fieldName: String
  }>
}
#end

/**
 * Provides compiler-aware helpers shared by classic Genes and genes-ts output.
 *
 * Why: a few operations, such as lazy module loading, need Haxe macro typing
 * and the active Genes emitter to cooperate. Keeping that protocol here gives
 * ordinary Haxe callers one API while both output profiles preserve the same
 * JavaScript behavior.
 *
 * What/How: public macros create typed expressions, while compiler-only carrier
 * calls retain facts that must be decided later from the current output
 * profile. Standard Haxe compilation still receives direct JavaScript syntax;
 * it never depends on the Genes carrier protocol.
 */
class Genes {
  /**
   * File suffix used for compiler-generated implementation artifacts.
   *
   * This value is configured when generation begins because emitters use it to
   * name files such as `Main.ts`, `Main.mjs`, or `Main.tsx`. Runtime import
   * requests use the separate policy documented by
   * `runtimeImportExtension()`.
   */
  @:persistent public static var outExtension: String = '.js';

  #if macro
  /**
   * Selects the suffix a JavaScript runtime should request for one artifact.
   *
   * Why: `.ts`, `.tsx`, and `.jsx` are source artifacts that another tool turns
   * into JavaScript, while `.mjs` is already the runtime file. Treating both as
   * one extension caused cold `.mjs` failures and cached warm-request suffixes.
   *
   * What/How: emitters call this pure policy with the current generation's
   * artifact extension. `dynamicImport()` carries only an extension-free typed
   * marker, so Haxe may safely cache that marker across server requests and
   * the active emitter still chooses the current runtime spelling.
   */
  public static function runtimeImportExtension(artifactExtension: String): String {
    if (Context.defined('genes.no_extension')
      || Context.defined('genes.ts.no_extension'))
      return '';
    return if (Context.defined('genes.ts') || artifactExtension == '.jsx'
      || artifactExtension == '.tsx' || artifactExtension == '.ts') '.js'; else
      artifactExtension;
  }

  static function tsStringLiteral(value: String): String {
    final escapedSlash = StringTools.replace(value, '\\', '\\\\');
    return '"' + StringTools.replace(escapedSlash, '"', '\\"') + '"';
  }

  static function functionArg(name: String, type: ComplexType): FunctionArg {
    return {
      name: name,
      opt: false,
      type: type,
      meta: null
    };
  }

  static function typedFunction(argName: String, type: ComplexType,
      body: Expr, pos: Position): Expr {
    return {
      expr: EFunction(null, {
        args: [functionArg(argName, type)],
        ret: null,
        expr: body
      }),
      pos: pos
    };
  }

  static function dynamicImportAccess(receiver: String, importType: String,
      localName: String, exportName: String): String {
    return if (Context.defined('genes.ts'))
      'var $localName = ($receiver as $importType).$exportName'; else
      'var $localName = $receiver.$exportName';
  }
  #end

  /**
   * Loads one or more Haxe modules with native JavaScript `import()`.
   *
   * Why: a dynamic request is created while Haxe types the macro, but its file
   * suffix belongs to the output profile that Genes emits later. A warm Haxe
   * server may reuse the typed expansion after the profile changes, so storing
   * `.ts`, `.tsx`, or `.mjs` in that expansion would make output depend on
   * request order.
   *
   * What: each function argument names a Haxe module to load. The callback runs
   * after every requested namespace is available and the returned promise
   * carries the callback result.
   *
   * How: with the Genes generator active, the macro emits an extension-free
   * `DynamicImportMarker`; the shared emitter replaces it with `import()` and
   * applies the current runtime suffix. Standard Haxe JS output instead emits
   * `import()` directly from `Compiler.getOutput()`. Dynamic requests do not
   * statically root their modules, so applications must retain each dynamic
   * entry point explicitly.
   */
  macro public static function dynamicImport<T, R>(expr: ExprOf<T->
    R>): ExprOf<js.lib.Promise<R>> {
    final pos = Context.currentPos();

    return switch expr.expr {
      case EFunction(_, {args: args, expr: body}):
        final current = Context.getLocalClass().get().module;
        final typedBody = Context.typeExpr(body);
        final ret = switch typedBody.t.toComplexType() {
          case null: (macro : Dynamic);
          case v: v;
        }

        final modules: Array<ImportedModule> = [];

        for (arg in args) {
          final type = Context.followWithAbstracts(Context.getType(arg.name));
          final fullname = type.toString();
          final moduleType = TypeUtil.typeToModuleType(type);
          final key = HaxeDeclarationKey.fromModuleType(moduleType);
          final exportName = TypeUtil.moduleTypeName(moduleType);
          final module = TypeUtil.moduleTypeModule(moduleType);
          final basePath = PathUtil.relative(current.replace('.', '/'),
            module.replace('.', '/'));
          final artifactExtension = switch Compiler.getOutput() {
            case null | '': '.js';
            case output:
              final extension = Path.extension(output);
              extension.length == 0 ? '' : '.$extension';
          }
          final path = basePath + runtimeImportExtension(artifactExtension);
          final sourcePosition = Context.getPosInfos(pos);
          final importExpr = if (Context.defined(CompilerInternal.GENERATOR_ACTIVE_DEFINE))
            macro @:pos(pos) genes.internal.DynamicImportMarker.load($v{basePath},
              $v{sourcePosition.file}, $v{sourcePosition.min},
            $v{sourcePosition.max}); else macro js.Syntax.code('import({0})',
            $v{path});

          switch modules.find(m -> m.name == module) {
            case null:
              modules.push({
                name: module,
                importType: 'typeof import(${tsStringLiteral(path)})',
                importExpr: importExpr,
                types: [
                  {
                    localName: arg.name,
                    exportName: exportName,
                    fullname: fullname,
                    key: key,
                    type: type
                  }
                ],
                directFunctions: []
              });
            case module:
              module.types.push({
                localName: arg.name,
                exportName: exportName,
                fullname: fullname,
                key: key,
                type: type
              });
          }
        }

        /**
         * Keep selected module functions callback-local in a lazy chunk.
         *
         * A top-level Haxe function survives typing as a static field on a
         * compiler-created module owner. Ordinary dependency planning would
         * turn that field into a top-level ESM import and defeat
         * `dynamicImport()`. The already typed callback identifies the exact
         * selected fields it uses, so add only those namespace aliases to the
         * existing compiler-owned setup.
         */
        function collectDirectFunctions(expression: TypedExpr): Void {
          switch expression.expr {
            case TField(_, FStatic(ownerRef, fieldRef)):
              final owner = ownerRef.get();
              final field = fieldRef.get();
              final request = ModuleFunctionRequestPlan.fromTypedField(ownerRef,
                fieldRef);
              if (request != null && request.isSourceModuleBinding) {
                final loaded = modules.find(candidate ->
                  candidate.name == owner.module);
                if (loaded != null
                  && loaded.directFunctions.find(candidate ->
                    candidate.fieldName == field.name) == null) {
                  loaded.directFunctions.push({
                    name: request.requestedName,
                    ownerModule: owner.module,
                    ownerName: owner.name,
                    fieldName: field.name
                  });
                }
              }
            default:
          }
          expression.iter(collectDirectFunctions);
        }
        collectDirectFunctions(typedBody);

        final candidates = [];
        for (moduleIndex in 0...modules.length) {
          final module = modules[moduleIndex];
          for (type in module.types) {
            candidates.push(DynamicImportBindingPlan.declaration(moduleIndex,
              type.key, type.localName, type.exportName));
          }
          for (direct in module.directFunctions) {
            candidates.push(DynamicImportBindingPlan.staticField(moduleIndex,
              new genes.BindingIdentity.StaticFieldOriginKey(direct.ownerModule,
                direct.ownerName, direct.fieldName),
              direct.name, direct.name));
          }
        }
        final reserved = new Map<String, String>();
        reserved.set('module', 'compiler dynamic-import namespace');
        reserved.set('modules', 'compiler dynamic-import namespace list');
        final bindingPlan = DynamicImportBindingPlan.build(candidates, pos,
          reserved);

        final e = switch modules {
          case [module]:
            final entries = bindingPlan.entriesForModule(0);
            final setup = [
              for (entry in entries)
                macro genes.internal.DynamicBindingDeclarationMarker.declare($v{entry.encoded()},
                  js.Syntax.code($v{
                  dynamicImportAccess('module', module.importType,
                    entry.localName(), entry.exportName())
                }))
            ];
            final list = [
              for (entry in entries)
                macro $v{entry.encoded()}
            ];

            final handler = macro genes.Genes.ignore($a{list}, $e{
              typedFunction('module', macro : genes.Genes.DynamicImportModule,
                macro {
                  @:mergeBlock $b{setup};
                  $body;
                }, pos)
            });

            macro ${module.importExpr}.then($handler);

          default:
            final setup = [];
            final ignores = [];

            for (i in 0...modules.length) {
              for (entry in bindingPlan.entriesForModule(i)) {
                setup.push(macro genes.internal.DynamicBindingDeclarationMarker.declare($v{entry.encoded()},
                  js.Syntax.code($v{
                  dynamicImportAccess('modules[$i]', modules[i].importType,
                    entry.localName(), entry.exportName())
                })));
                ignores.push(macro $v{entry.encoded()});
              }
            }

            final imports = macro $a{modules.map(module -> module.importExpr)};
            macro js.lib.Promise.all($imports)
              .then(genes.Genes.ignore($a{ignores}, $e{
                typedFunction('modules',
                  macro : genes.Genes.DynamicImportModules, macro {
                    @:mergeBlock $b{setup};
                    $body;
                  }, pos)
              }));
        }

        // Keep the outer expansion at the authored macro call. Nested carrier
        // positions preserve the same range for the exact `import()` token.
        macro @:pos(pos) ($e : js.lib.Promise<$ret>);

      default:
        Context.error('Cannot import', expr.pos);
    }
  }

  public static function ignore<T>(names: Array<String>, res: T)
    return res;
}

/**
 * Opaque JavaScript module namespace used only inside `dynamicImport()`.
 *
 * A loaded namespace is inherently host-shaped before the macro selects its
 * requested Haxe declarations. The generated TypeScript boundary is therefore
 * `unknown`, but user code never receives or inspects this value: the macro
 * immediately narrows named exports into their precise Haxe types.
 */
@:ts.type("unknown")
abstract DynamicImportModule(Dynamic) from Dynamic to Dynamic {}

/**
 * Opaque list of module namespaces used by multi-module `dynamicImport()`.
 *
 * As with `DynamicImportModule`, the weak representation is confined to the
 * generated promise handler and every selected export becomes typed before the
 * authored callback runs.
 */
@:ts.type("unknown[]")
abstract DynamicImportModules(Array<Dynamic>) from Array<Dynamic>
  to Array<Dynamic> {}
