package sideeffectevidence;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;
import genes.CompilerInternal;

using haxe.macro.TypedExprTools;

/**
 * Compile-time proof for the Haxe facts behind side-effect request carriers.
 *
 * Why: generated source cannot prove that a marker survived Haxe's full DCE or
 * that its typed order reached the custom generator. The architecture must not
 * enable a public helper based on an assumed compiler phase order.
 *
 * What: the `onGenerate` callback inspects the same post-DCE typed declarations
 * supplied to Genes. It requires the four direct `cl.init` markers in source
 * order, both minimal target anchors and explicitly kept initializer fields,
 * and absence of a kept target whose module was never typed.
 *
 * How: the probe matches compiler-owned type/field identities and literal
 * arguments. A mismatch raises a source-positioned compiler error, so both the
 * TS and classic HXML files are executable evidence rather than an inspection
 * note. The callback keeps no process-global occurrence registry.
 */
class DceProbe {
  public static function install():Void {
    Context.onGenerate(validate);
  }

  static function validate(types:Array<Type>):Void {
    var main:Null<ClassType> = null;
    var first:Null<ClassType> = null;
    var second:Null<ClassType> = null;
    var deadFound = false;

    for (type in types) {
      switch type {
        case TInst(ref, _):
          final cl = ref.get();
          switch cl.module {
            case 'sideeffectevidence.Main': main = cl;
            case 'sideeffectevidence.First': first = cl;
            case 'sideeffectevidence.Second': second = cl;
            case 'sideeffectevidence.DeadTarget': deadFound = true;
            default:
          }
        default:
      }
    }

    require(main != null, 'post-DCE Main class', Context.currentPos());
    require(first != null, 'kept First target', Context.currentPos());
    require(second != null, 'kept Second target', Context.currentPos());
    require(!deadFound,
      'the completely unreferenced DeadTarget module to remain untyped',
      Context.currentPos());

    final markerOrder:Array<String> = [];
    collectMarkers(main.init, markerOrder);
    final expected = [
      'external:before:none',
      'internal:First.__ts2hxInit',
      'internal:Second.__ts2hxInit',
      'external:after:json'
    ];
    require(markerOrder.join('|') == expected.join('|'),
      'marker order ${expected.join(" -> ")} but found ${markerOrder.join(" -> ")}',
      main.pos);

    requireAnchor(first);
    requireAnchor(second);
  }

  static function collectMarkers(expression:Null<TypedExpr>,
      result:Array<String>):Void {
    if (expression == null)
      return;
    if (CompilerInternal.isSideEffectImportMarkerCall(expression)) {
      switch expression.expr {
        case TCall({expr: TField(_, FStatic(_, fieldRef))}, arguments):
          final field = fieldRef.get();
          switch field.name {
            case 'external':
              final module = stringArgument(arguments, 0, expression);
              final attribute = nullableStringArgument(arguments, 1,
                expression);
              result.push('external:$module:${attribute == null ? "none" : attribute}');
            case 'internal':
              result.push('internal:' + internalReference(arguments,
                expression));
            default:
              Context.error('Unexpected side-effect marker ${field.name}',
                expression.pos);
          }
        default:
          Context.error('CompilerInternal accepted a non-call marker',
            expression.pos);
      }
      return;
    }
    expression.iter(child -> collectMarkers(child, result));
  }

  static function stringArgument(arguments:Array<TypedExpr>, index:Int,
      owner:TypedExpr):String {
    if (index >= arguments.length)
      Context.error('Missing marker string argument $index', owner.pos);
    return switch arguments[index].expr {
      case TConst(TString(value)): value;
      default: Context.error('Marker argument $index is not a string literal',
        arguments[index].pos);
    }
  }

  static function nullableStringArgument(arguments:Array<TypedExpr>, index:Int,
      owner:TypedExpr):Null<String> {
    if (index >= arguments.length)
      Context.error('Missing marker optional argument $index', owner.pos);
    return switch arguments[index].expr {
      case TConst(TNull): null;
      case TConst(TString(value)): value;
      default: Context.error('Marker argument $index is not null or a string literal',
        arguments[index].pos);
    }
  }

  static function internalReference(arguments:Array<TypedExpr>,
      owner:TypedExpr):String {
    if (arguments.length != 1)
      Context.error('Internal marker requires one typed reference', owner.pos);
    return switch arguments[0].expr {
      case TField({expr: TTypeExpr(TClassDecl(target))},
          FStatic(_, fieldRef)):
        '${target.get().name}.${fieldRef.get().name}';
      default:
        Context.error('Internal marker did not retain a static typed reference',
          arguments[0].pos);
    }
  }

  static function requireAnchor(cl:ClassType):Void {
    var initialized = false;
    var anchor = false;
    for (field in cl.statics.get()) {
      if (field.name == 'initialized' && field.meta.has(':keep')
        && field.expr() != null)
        initialized = true;
      if (field.name == '__ts2hxInit'
        && CompilerInternal.isField(field.meta))
        anchor = true;
    }
    require(initialized,
      '${cl.name}.initialized with a retained expression after full DCE',
      cl.pos);
    require(anchor, '${cl.name} compiler-internal anchor after full DCE', cl.pos);
  }

  static function require(condition:Bool, expectation:String,
      position:haxe.macro.Expr.Position):Void {
    if (!condition)
      Context.error('Side-effect DCE probe expected $expectation', position);
  }
}
#end
