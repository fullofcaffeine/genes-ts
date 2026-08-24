package asyncawaitevidence;

#if macro
import genes.CompilerInternal;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;
#end

/** Verifies the exact typed carrier boundary before Haxe DCE runs. */
class NativeAsyncInventoryProbe {
  public static macro function install(): Expr {
    #if macro
    Context.onAfterTyping(types -> {
      var functionMarkers = 0;
      var returnMarkers = 0;
      var authoredCastPayloads = 0;
      var copiedMemberCalls = 0;
      var copiedRawTemplates = 0;

      function visit(expression: Null<TypedExpr>): Void {
        if (expression == null)
          return;
        final functionMarker = CompilerInternal.nativeAsyncFunctionValueCall(expression);
        if (functionMarker != null) {
          functionMarkers++;
          switch functionMarker.value.expr {
            case TFunction(_):
            default:
              Context.error('native async function marker lost its exact TFunction',
                expression.pos);
          }
        }

        final returnMarker = CompilerInternal.nativeAsyncReturnValueCall(expression);
        if (returnMarker != null) {
          returnMarkers++;
          switch returnMarker.value.expr {
            case TCast(_, null):
              authoredCastPayloads++;
            default:
          }
        }

        switch expression.expr {
          case TCall({
            expr: TField(_,
              FStatic(_.get() => owner, _.get() => {name: 'functionValue'}))
          }, _) if (owner.module == 'asyncawaitevidence.Main'):
            copiedMemberCalls++;
            if (functionMarker != null)
              Context.error('same-named user member authenticated compiler behavior',
                expression.pos);
          case TCall({
            expr: TField(_,
              FStatic(_.get() => {module: 'js.Syntax'},
                _.get() => {name: 'code'}))
          }, [{expr: TConst(TString('async {0}'))}, _]):
            copiedRawTemplates++;
            if (functionMarker != null)
              Context.error('copied raw template authenticated compiler behavior',
                expression.pos);
          default:
        }
        expression.iter(visit);
      }

      for (type in types) {
        switch type {
          case TClassDecl(reference)
            if (reference.get().module == 'asyncawaitevidence.Main'):
            final value = reference.get();
            for (field in value.fields.get().concat(value.statics.get()))
              visit(field.expr());
          default:
        }
      }

      if (functionMarkers < 4)
        Context.error('missing exact anonymous native async function carriers',
          Context.currentPos());
      if (returnMarkers == 0)
        Context.error('missing exact native async return carriers',
          Context.currentPos());
      if (authoredCastPayloads == 0)
        Context.error('the macro-owned return bridge swallowed its authored cast payload',
          Context.currentPos());
      if (copiedMemberCalls != 1)
        Context.error('same-named user member control was not typed exactly once',
          Context.currentPos());
      if (copiedRawTemplates != 1)
        Context.error('copied raw async control was not typed exactly once',
          Context.currentPos());
    });
    #end
    return macro null;
  }
}
