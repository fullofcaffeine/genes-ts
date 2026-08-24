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
 * Direct module functions and values replace the synthetic owner's
 * `TTypeExpr` with an exact named ESM binding. Keeping each occurrence
 * distinct lets dependency planning preserve expression order.
 */
enum RuntimeTypeOccurrence {
  RuntimeType(type: ModuleType);
  DirectModuleFunction(owner: Ref<ClassType>, field: Ref<ClassField>,
    request: ModuleFunctionEntry);
  DirectModuleValue(owner: Ref<ClassType>, field: Ref<ClassField>,
    requestedName: String);
}

/**
 * Collects runtime type tokens without losing their expression occurrence.
 *
 * Why: `TypeUtil.typesInExpr` returns only a flat list of module types. Direct
 * binding lowering replaces one exact synthetic-owner receiver with a named
 * ESM binding. Another receiver for that owner can still access an ordinary
 * field. Filtering only by owner identity can remove both required forms.
 *
 * What/How: this collector preserves the established runtime-type traversal,
 * including `Genes.ignore`, constructor types, and cast support. Its optional
 * classifiers replace only exact selected static-field occurrences. Unrelated
 * occurrences of the same synthetic owner remain ordinary runtime types.
 * `Genes.ignore` removes a record only for that exact lazy module.
 */
class RuntimeTypeOccurrenceCollector {
  public static function collect(expression: TypedExpr,
      ?resolveDirectModuleFunction: (Ref<ClassType>,
      Ref<ClassField>) -> Null<ModuleFunctionEntry>,
      ?resolveDirectModuleValue: (Ref<ClassType>,
      Ref<ClassField>) -> Null<String>,
      ?resolveNativeAsyncValue: TypedExpr->
      Null<TypedExpr>): Array<RuntimeTypeOccurrence> {
    return switch expression {
      case null:
        [];
      case value if (CompilerInternal.isNativeAsyncMarkerCall(value)):
        final planned = resolveNativeAsyncValue == null ? null : resolveNativeAsyncValue(value);
        if (planned == null)
          CompilerDiagnostic.fail('GENES-NATIVE-ASYNC-PLAN-003: native async marker has no exact planned value',
            value.pos);
        collect(planned, resolveDirectModuleFunction,
          resolveDirectModuleValue, resolveNativeAsyncValue);
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
        collect(call, resolveDirectModuleFunction, resolveDirectModuleValue,
          resolveNativeAsyncValue).concat(collect(body,
            resolveDirectModuleFunction, resolveDirectModuleValue,
            resolveNativeAsyncValue).filter(occurrence -> {
              for (name in names) {
                final token = DynamicImportBindingPlan.decode(name);
                final matches = switch [token, occurrence] {
                  case [Declaration(kind, module, declarationName, _,
                    _), RuntimeType(type)]: final key = HaxeDeclarationKey.fromModuleType(type); Std.string(key.kind) == kind && key.module == module && key.name == declarationName;
                  case [
                    StaticField(ownerModule, ownerName, fieldName, _, _),
                    DirectModuleFunction(_, _, request)
                  ]: request.origin.ownerModule == ownerModule && request.origin.ownerName == ownerName && request.origin.fieldName == fieldName;
                  case [
                    StaticField(ownerModule, ownerName, fieldName, _, _),
                    DirectModuleValue(owner, field, _)
                  ]: owner.get()
                      .module == ownerModule && owner.get()
                      .name == ownerName && field.get().name == fieldName;
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
      case {expr: TField(_, FStatic(owner, field))}
        if (resolveDirectModuleValue != null
          && resolveDirectModuleValue(owner, field) != null):
        [DirectModuleValue(owner, field,
          resolveDirectModuleValue(owner, field))];
      case {expr: TTypeExpr(type)}:
        [RuntimeType(type)];
      case {expr: TNew(owner, _, arguments)}:
        var result = [RuntimeType(TClassDecl(owner))];
        for (argument in arguments)
          result = result.concat(collect(argument,
            resolveDirectModuleFunction, resolveDirectModuleValue,
            resolveNativeAsyncValue));
        result;
      case {expr: TCast(inner, null)}:
        collect(inner, resolveDirectModuleFunction, resolveDirectModuleValue,
          resolveNativeAsyncValue);
      case {expr: TCast(inner, target)}:
        collect(inner, resolveDirectModuleFunction, resolveDirectModuleValue,
          resolveNativeAsyncValue)
          .concat([RuntimeType(target), RuntimeType(TypeUtil.bootType)]);
      case other:
        var result = [];
        other.iter(child -> {
          result = result.concat(collect(child, resolveDirectModuleFunction,
            resolveDirectModuleValue, resolveNativeAsyncValue));
        });
        result;
    }
  }
}
#end
