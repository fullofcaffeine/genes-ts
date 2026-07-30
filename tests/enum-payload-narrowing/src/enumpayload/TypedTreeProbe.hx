package enumpayload;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.TypeTools;
import genes.ts.TsBoundaryPlan;

using haxe.macro.TypedExprTools;

/** Pins the compiler-owned evidence that authorizes this one TS projection. */
class TypedTreeProbe {
  public static macro function install(): Expr {
    final shadowReduced = switch Context.getType("enumpayload.ShadowReduction") {
      case TEnum(reference, _): reference.get().constructs.get("Reduced");
      default: throw "expected ShadowReduction enum";
    };
    Context.onAfterTyping(types -> {
      var foundElidedPayload = false;
      var foundImportedPayload = false;
      var foundVisibleSwitch = false;
      var visiblePayloads = 0;
      for (type in types)
        switch type {
          case TClassDecl(reference)
            if (reference.get().module == "enumpayload.Main"):
            for (field in reference.get().statics.get())
              if (field.expr() != null)
                inspect(field.name, field.expr(), shadowReduced, evidence -> {
                  switch evidence {
                    case ElidedPayload:
                      foundElidedPayload = true;
                    case VisibleSwitch:
                      foundVisibleSwitch = true;
                    case VisiblePayload:
                      visiblePayloads++;
                    case ImportedPayload:
                      foundImportedPayload = true;
                  }
                });
          default:
        }
      if (!foundElidedPayload)
        Context.error("expected one exact elided Reduced payload read",
          Context.currentPos());
      if (!foundVisibleSwitch || visiblePayloads != 4)
        Context.error("expected one visible enum switch with four payload reads",
          Context.currentPos());
      if (!foundImportedPayload)
        Context.error("expected one imported-marker payload read",
          Context.currentPos());
    });
    return macro null;
  }

  static function inspect(field: String, expression: TypedExpr,
      shadowReduced: EnumField, found: ProbeEvidence->Void): Void {
    function visit(value: TypedExpr): Void {
      switch value.expr {
        case TSwitch(condition, cases, _) if (field == "visible"):
          final conditionShape = shape(condition);
          final indexes = [
            for (entry in cases)
              for (candidate in entry.values)
                shape(candidate)
          ];
          if (!StringTools.startsWith(conditionShape, "enum-index(local#")
            || indexes.join(",") != "int:0,int:1,int:2")
            Context.error("visible switch lost its exact enum discriminants",
              value.pos);
          found(VisibleSwitch);
        case TEnumParameter(receiver, constructor, index):
          if (!TsBoundaryPlan.hasExactEnumPayloadEvidence(value))
            Context.error("valid enum payload evidence was rejected",
              value.pos);
          if (field != "imported"
            && !StringTools.startsWith(shape(receiver), "local#"))
            Context.error("enum payload receiver must retain local identity",
              value.pos);
          if (field == "elided") {
            if (constructor.name != "Reduced"
              || constructor.index != 2
              || index != 0
              || TypeTools.toString(receiver.t) != "enumpayload.Reduction<Int, enumpayload.Never, enumpayload.Never, String>"
              || TypeTools.toString(value.t) != "String")
              Context.error("elided payload lost its exact typed evidence",
                value.pos);
            found(ElidedPayload);
            assertNegativeControls(value, receiver, constructor, index,
              shadowReduced);
          } else if (field == "visible") {
            found(VisiblePayload);
          } else if (field == "imported") {
            if (constructor.name != "Reduced"
              || !StringTools.startsWith(shape(receiver), "local#")
              || TypeTools.toString(value.t) != "enumpayload.marker.PlannedMarker")
              Context.error("imported payload lost its exact marker type",
                value.pos);
            found(ImportedPayload);
          }
        default:
      }
      value.iter(visit);
    }
    visit(expression);
  }

  static function assertNegativeControls(expression: TypedExpr,
      receiver: TypedExpr, constructor: EnumField, index: Int,
      shadowReduced: EnumField): Void {
    // This synthetic negative deliberately replaces the exact enum receiver
    // with Dynamic. No runtime value crosses this boundary: the probe only
    // proves that erased type evidence cannot authorize a compiler decision.
    final dynamicReceiver: TypedExpr = {
      expr: receiver.expr,
      pos: receiver.pos,
      t: TDynamic(null)
    };
    reject({
      expr: TEnumParameter(dynamicReceiver, constructor, index),
      pos: expression.pos,
      t: expression.t
    }, "a Dynamic receiver");
    reject({
      expr: TEnumParameter(receiver, constructor, 99),
      pos: expression.pos,
      t: expression.t
    }, "an invalid payload slot");

    reject({
      expr: TEnumParameter(receiver, shadowReduced, index),
      pos: expression.pos,
      t: expression.t
    }, "a same-named constructor from another enum");
  }

  static function reject(expression: TypedExpr, description: String): Void {
    if (TsBoundaryPlan.hasExactEnumPayloadEvidence(expression))
      Context.error('$description must not authorize a payload projection',
        expression.pos);
  }

  static function shape(expression: TypedExpr): String {
    return switch expression.expr {
      case TLocal(variable): 'local#${variable.id}:${variable.name}';
      case TEnumIndex(receiver): 'enum-index(${shape(receiver)})';
      case TConst(TInt(value)): 'int:$value';
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        shape(inner);
      default:
        expression.expr.getName();
    }
  }
}

private enum ProbeEvidence {
  ElidedPayload;
  VisibleSwitch;
  VisiblePayload;
  ImportedPayload;
}
#end
