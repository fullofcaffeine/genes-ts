package genes;

#if macro
import haxe.macro.Type;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;
using haxe.macro.TypeTools;

/**
 * Collects runtime type tokens without losing their expression occurrence.
 *
 * Why: `TypeUtil.typesInExpr` returns only a flat list of module types. Direct
 * module-function lowering replaces one exact synthetic-owner receiver with a
 * named ESM binding, but another receiver for the same owner may still access
 * an ordinary module value. Filtering the flat list by owner identity removes
 * both and can leave generated code without its required owner import.
 *
 * What/How: this collector preserves the established runtime-type traversal,
 * including `Genes.ignore`, constructor types, and cast support. Its optional
 * callback can suppress only the exact `TTypeExpr` object replaced by another
 * dependency decision. Unrelated occurrences of the same `ModuleType` remain.
 */
class RuntimeTypeOccurrenceCollector {
  public static function collect(expression: TypedExpr,
      ?skipTypeExpression: TypedExpr->Bool): Array<ModuleType> {
    return switch expression {
      case null:
        [];
      case {
        expr: TCall(call = {
          expr: TField(_,
            FStatic(_.get() => {module: 'genes.Genes'},
              _.get() => {name: 'ignore'}))
        }, [{expr: TArrayDecl(typeExpressions)}, body])
      }:
        final names = [
          for (typeExpression in typeExpressions)
            switch typeExpression.expr {
              case TConst(TString(name)):
                name;
              default:
                continue;
            }
        ];
        collect(call,
          skipTypeExpression).concat(collect(body,
            skipTypeExpression).filter(type -> {
              return switch type {
                case TClassDecl(TInst(_, []).toString() => name) |
                  TEnumDecl(TEnum(_, []).toString() => name):
                  names.indexOf(name) < 0;
                default:
                  true;
              }
            }));
      case {expr: TTypeExpr(type)}:
        if (skipTypeExpression != null && skipTypeExpression(expression))
          [] else [type];
      case {expr: TNew(owner, _, arguments)}:
        var result = [TClassDecl(owner)];
        for (argument in arguments)
          result = result.concat(collect(argument, skipTypeExpression));
        result;
      case {expr: TCast(inner, null)}:
        collect(inner, skipTypeExpression);
      case {expr: TCast(inner, target)}:
        collect(inner, skipTypeExpression).concat([target, TypeUtil.bootType]);
      case other:
        var result = [];
        other.iter(child -> {
          result = result.concat(collect(child, skipTypeExpression));
        });
        result;
    }
  }
}
#end
