package genes;

#if macro
import haxe.macro.Expr;
import haxe.macro.Context;
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

class Genes {
  @:persistent public static var outExtension: String = '.js';

#if macro
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
          final path = PathUtil.relative(current.replace('.', '/'),
            module.replace('.', '/'))
          #if !(genes.no_extension || genes.ts.no_extension)
          + outExtension
          #end
          ;

          switch modules.find(m -> m.name == module) {
            case null:
              modules.push({
                name: module,
                importType: 'typeof import(${tsStringLiteral(path)})',
                importExpr: macro js.Syntax.code('import({0})', $v{path}),
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

        macro($e : js.lib.Promise<$ret>);

      default:
        Context.error('Cannot import', expr.pos);
    }
  }

  public static function ignore<T>(names: Array<String>, res: T)
    return res;
}

@:ts.type("unknown")
abstract DynamicImportModule(Dynamic) from Dynamic to Dynamic {}

@:ts.type("unknown[]")
abstract DynamicImportModules(Array<Dynamic>) from Array<Dynamic> to Array<Dynamic> {}
