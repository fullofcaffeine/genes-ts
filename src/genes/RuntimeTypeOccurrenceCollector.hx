package genes;

#if macro
import haxe.macro.Type;
import genes.util.TypeUtil;
import genes.ModuleFunctionPlan.ModuleFunctionEntry;
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.DynamicImportBindingPlan.DynamicImportBindingToken;

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
  DirectModuleFunction(owner: Ref<ClassType>, field: Ref<ClassField>,
    request: ModuleFunctionEntry);
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
      ?resolveDirectModuleFunction: (Ref<ClassType>,
      Ref<ClassField>) ->
        Null<ModuleFunctionEntry>): Array<RuntimeTypeOccurrence> {
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
          resolveDirectModuleFunction).concat(collect(body,
            resolveDirectModuleFunction).filter(occurrence -> {
              for (name in names) {
                final token = DynamicImportBindingPlan.decode(name);
                final matches = switch [token, occurrence] {
                  case [Declaration(kind, module, declarationName, _,
                    _), RuntimeType(type)]: final key = HaxeDeclarationKey.fromModuleType(type); Std.string(key.kind) == kind && key.module == module && key.name == declarationName;
                  case [
                    StaticField(ownerModule, ownerName, fieldName, _, _),
                    DirectModuleFunction(_, _, request)
                  ]: request.origin.ownerModule == ownerModule && request.origin.ownerName == ownerName && request.origin.fieldName == fieldName;
                  default:
                    false;
                };
                if (matches)
                  return false;
              }
              return true;
            }));
      case {
        expr: TField(_, FStatic(owner, field))
      }
        if (resolveDirectModuleFunction != null
          && resolveDirectModuleFunction(owner, field) != null):
        [DirectModuleFunction(owner, field,
          resolveDirectModuleFunction(owner, field))];
      case {expr: TTypeExpr(type)}:
        [RuntimeType(type)];
      case {expr: TNew(owner, _, arguments)}:
        var result = [RuntimeType(TClassDecl(owner))];
        for (argument in arguments)
          result = result.concat(collect(argument,
            resolveDirectModuleFunction));
        result;
      case {expr: TCast(inner, null)}:
        collect(inner, resolveDirectModuleFunction);
      case {expr: TCast(inner, target)}:
        collect(inner,
          resolveDirectModuleFunction)
          .concat([RuntimeType(target), RuntimeType(TypeUtil.bootType)]);
      case other:
        var result = [];
        other.iter(child -> {
          result = result.concat(collect(child, resolveDirectModuleFunction));
        });
        result;
    }
  }
}
#end
