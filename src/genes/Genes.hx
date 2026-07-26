package genes;

#if macro
import haxe.macro.Expr;
import haxe.macro.Context;
import haxe.macro.Compiler;
import haxe.io.Path;
import genes.util.PathUtil;
import genes.util.TypeUtil;

using haxe.macro.TypeTools;
using Lambda;

private typedef ImportedModule = {
  name: String,
  importType: String,
  importExpr: Expr,
  types: Array<{
    name: String,
    fullname: String,
    type: haxe.macro.Type
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
    return if (Context.defined('genes.ts')
      || artifactExtension == '.jsx'
      || artifactExtension == '.tsx'
      || artifactExtension == '.ts')
      '.js';
    else
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

  static function typedFunction(argName: String, type: ComplexType, body: Expr,
      pos: Position): Expr {
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
      name: String): String {
    return if (Context.defined('genes.ts'))
      'var $name = ($receiver as $importType).$name';
    else
      'var $name = $receiver.$name';
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
        final ret = switch Context.typeExpr(body).t.toComplexType() {
          case null: (macro:Dynamic);
          case v: v;
        }

        final modules: Array<ImportedModule> = [];

        for (arg in args) {
          final type = Context.followWithAbstracts(Context.getType(arg.name));
          final fullname = type.toString();
          final name = fullname.split('.').pop();
          final module = TypeUtil.moduleTypeModule(TypeUtil.typeToModuleType(type));
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
          final importExpr = if (Context.defined(
            CompilerInternal.GENERATOR_ACTIVE_DEFINE))
            macro @:pos(pos) genes.internal.DynamicImportMarker.load(
              $v{basePath},
              $v{sourcePosition.file},
              $v{sourcePosition.min},
              $v{sourcePosition.max});
          else
            macro js.Syntax.code('import({0})', $v{path});

          switch modules.find(m -> m.name == module) {
            case null:
              modules.push({
                name: module,
                importType: 'typeof import(${tsStringLiteral(path)})',
                importExpr: importExpr,
                types: [
                  {
                    name: name,
                    fullname: fullname,
                    type: type
                  }
                ]
              });
            case module:
              module.types.push({name: name, fullname: fullname, type: type});
          }
        }

        final e = switch modules {
          case [module]:
            final setup = [
              for (sub in module.types)
                macro js.Syntax.code($v{dynamicImportAccess('module', module.importType, sub.name)})
            ];

            final list = [for (sub in module.types) macro $v{sub.fullname}];

            final handler = macro genes.Genes.ignore($a{list},
              $e{typedFunction('module', macro:genes.Genes.DynamicImportModule, macro {
                @:mergeBlock $b{setup};
                $body;
              }, pos)});

            macro ${module.importExpr}.then($handler);

          default:
            final setup = [];
            final ignores = [];

            for (i in 0...modules.length) {
              for (sub in modules[i].types) {
                setup.push(macro js.Syntax.code($v{dynamicImportAccess('modules[$i]', modules[i].importType, sub.name)}));
                ignores.push(macro $v{sub.fullname});
              }
            }

            final imports = macro $a{modules.map(module -> module.importExpr)};
            macro js.lib.Promise.all($imports)
              .then(genes.Genes.ignore($a{ignores},
                $e{typedFunction('modules', macro:genes.Genes.DynamicImportModules, macro {
                @:mergeBlock $b{setup};
                $body;
              }, pos)}));
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
abstract DynamicImportModules(Array<Dynamic>) from Array<Dynamic> to Array<Dynamic> {}
