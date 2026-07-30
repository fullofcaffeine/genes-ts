package genes;

#if macro
import haxe.macro.Type;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;
using haxe.macro.TypeTools;

/**
 * One runtime dependency occurrence in the original expression order.
 *
 * Direct module functions replace the synthetic owner's `TTypeExpr` with an
 * exact named ESM binding. Keeping that occurrence distinct lets dependency
 * planning preserve argument order without first collecting every direct
 * function into a separate, reordered pass.
 */
enum RuntimeTypeOccurrence {
  RuntimeType(type: ModuleType);
  DirectModuleFunction(owner: Ref<ClassType>, field: Ref<ClassField>);
}

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
 * classifier replaces only an exact selected static-field occurrence with a
 * direct-function record. Unrelated occurrences of the same synthetic owner
 * remain ordinary runtime types. `Genes.ignore` removes either record only
 * when the carrier names that exact lazy module.
 */
class RuntimeTypeOccurrenceCollector {
  public static function collect(expression: TypedExpr,
      ?isDirectModuleFunction: (ClassType,
      ClassField) -> Bool): Array<RuntimeTypeOccurrence> {
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
          isDirectModuleFunction).concat(collect(body,
            isDirectModuleFunction).filter(occurrence -> {
              final name = switch occurrence {
                case RuntimeType(TClassDecl(owner)):
                  TInst(owner, []).toString();
                case RuntimeType(TEnumDecl(owner)):
                  TEnum(owner, []).toString();
                case DirectModuleFunction(owner, fieldRef):
                  final classType = owner.get();
                  final field = fieldRef.get();
                  final requested = ModuleFunctionPlan.requestedName(field);
                  requested == null ? null : ModuleFunctionPlan.dynamicImportFieldToken(classType.module,
                    classType.name, field.name, requested);
                default:
                  null;
              };
              return name == null || names.indexOf(name) < 0;
            }));
      case {
        expr: TField(_, FStatic(owner, field))
      }
        if (isDirectModuleFunction != null
          && isDirectModuleFunction(owner.get(), field.get())):
        [DirectModuleFunction(owner, field)];
      case {expr: TTypeExpr(type)}:
        [RuntimeType(type)];
      case {expr: TNew(owner, _, arguments)}:
        var result = [RuntimeType(TClassDecl(owner))];
        for (argument in arguments)
          result = result.concat(collect(argument, isDirectModuleFunction));
        result;
      case {expr: TCast(inner, null)}:
        collect(inner, isDirectModuleFunction);
      case {expr: TCast(inner, target)}:
        collect(inner,
          isDirectModuleFunction)
          .concat([RuntimeType(target), RuntimeType(TypeUtil.bootType)]);
      case other:
        var result = [];
        other.iter(child -> {
          result = result.concat(collect(child, isDirectModuleFunction));
        });
        result;
    }
  }
}
#end
