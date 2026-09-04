package genes;

#if macro
import haxe.Json;
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.JSGenApi;
import haxe.macro.Type;
import sys.FileSystem;
import sys.io.File;

using haxe.macro.TypedExprTools;

/**
 * Measures the least work available at Genes' typed-program boundary.
 *
 * Why: an end-to-end compile cannot show whether the practical latency floor
 * is Haxe's callback boundary, one visit of the typed program, or Genes'
 * semantic planning and emission. Architecture choices need those costs
 * separated before production state or another runtime is introduced.
 *
 * What/How: the private benchmark define selects either an immediate callback
 * return or one read-only visit of every compiler-supplied declaration body.
 * A request-local JSON record describes the exact structures observed. The
 * probe never constructs a Module, emitter, or OutputTransaction. It is absent
 * from ordinary builds and must not be used as a compiler feature.
 */
@:noCompletion
class GenerationFloorProbe {
  public static inline final ENABLE_DEFINE = 'genes_generation_floor';
  public static inline final MODE_DEFINE = 'genes_generation_floor_mode';
  public static inline final REPORT_DEFINE = 'genes_generation_floor_report';

  /** Runs one explicitly selected floor and writes its request-local counters. */
  public static function run(api: JSGenApi): Void {
    final mode = requiredDefine(MODE_DEFINE);
    final reportPath = requiredDefine(REPORT_DEFINE);
    final counters = new GenerationFloorCounters(api.types.length,
      api.main == null ? 0 : 1);

    switch mode {
      case 'callback-noop':
      case 'structure-scan':
        counters.scan(api);
      case _:
        Context.error('Unsupported Genes generation floor mode "$mode".',
          Context.currentPos());
    }

    final directory = Path.directory(reportPath);
    if (directory.length > 0 && !FileSystem.exists(directory))
      FileSystem.createDirectory(directory);
    File.saveContent(reportPath, Json.stringify({
      schemaVersion: 1,
      mode: mode,
      counters: counters.toReport()
    }) + '\n');
  }

  static function requiredDefine(name: String): String {
    final value = Context.definedValue(name);
    if (value == null || value == '1' || value.length == 0)
      Context.error('Genes generation floor requires -D $name=<value>.',
        Context.currentPos());
    return value;
  }
}

/** Counts one explicit read-only pass over compiler-supplied declarations. */
private class GenerationFloorCounters {
  final apiTypeEntries: Int;
  final mainExpressionRoots: Int;
  var classDeclarations = 0;
  var enumDeclarations = 0;
  var typedefDeclarations = 0;
  var abstractDeclarations = 0;
  var otherTypeEntries = 0;
  var fieldDeclarations = 0;
  var expressionRoots = 0;
  var expressionNodes = 0;
  var typeRoots = 0;
  var typeNodes = 0;
  var scanPasses = 0;

  public function new(apiTypeEntries: Int, mainExpressionRoots: Int) {
    this.apiTypeEntries = apiTypeEntries;
    this.mainExpressionRoots = mainExpressionRoots;
  }

  public function scan(api: JSGenApi): Void {
    scanPasses++;
    for (type in api.types)
      scanDeclaration(type);
    if (api.main != null)
      scanExpressionRoot(api.main);
  }

  public function toReport() {
    return {
      scanPasses: scanPasses,
      apiTypeEntries: apiTypeEntries,
      mainExpressionRoots: mainExpressionRoots,
      classDeclarations: classDeclarations,
      enumDeclarations: enumDeclarations,
      typedefDeclarations: typedefDeclarations,
      abstractDeclarations: abstractDeclarations,
      otherTypeEntries: otherTypeEntries,
      fieldDeclarations: fieldDeclarations,
      expressionRoots: expressionRoots,
      expressionNodes: expressionNodes,
      typeRoots: typeRoots,
      typeNodes: typeNodes
    };
  }

  function scanDeclaration(type: Type): Void {
    scanTypeRoot(type);
    switch type {
      case TInst(reference, _):
        classDeclarations++;
        final cl = reference.get();
        for (parameter in cl.params)
          scanTypeParameter(parameter);
        final superClass = cl.superClass;
        if (superClass != null)
          for (parameter in superClass.params)
            scanTypeRoot(parameter);
        for (implemented in cl.interfaces)
          for (parameter in implemented.params)
            scanTypeRoot(parameter);
        if (cl.constructor != null)
          scanField(cl.constructor.get());
        for (field in cl.fields.get())
          scanField(field);
        for (field in cl.statics.get())
          scanField(field);
        if (cl.init != null)
          scanExpressionRoot(cl.init);
      case TEnum(reference, _):
        enumDeclarations++;
        final enumType = reference.get();
        for (parameter in enumType.params)
          scanTypeParameter(parameter);
        for (_ => constructor in enumType.constructs) {
          for (parameter in constructor.params)
            scanTypeParameter(parameter);
          scanTypeRoot(constructor.type);
        }
      case TType(reference, _):
        typedefDeclarations++;
        final definition = reference.get();
        for (parameter in definition.params)
          scanTypeParameter(parameter);
        scanTypeRoot(definition.type);
      case TAbstract(reference, _):
        abstractDeclarations++;
        final abstractType = reference.get();
        for (parameter in abstractType.params)
          scanTypeParameter(parameter);
        scanTypeRoot(abstractType.type);
        for (conversion in abstractType.from)
          scanTypeRoot(conversion.t);
        for (conversion in abstractType.to)
          scanTypeRoot(conversion.t);
      case TMono(_) | TFun(_, _) | TAnonymous(_) | TDynamic(_) | TLazy(_):
        otherTypeEntries++;
    }
  }

  function scanField(field: ClassField): Void {
    fieldDeclarations++;
    scanTypeRoot(field.type);
    for (parameter in field.params)
      scanTypeParameter(parameter);
    final expression = field.expr();
    if (expression != null)
      scanExpressionRoot(expression);
    for (overloadedField in field.overloads.get())
      scanField(overloadedField);
  }

  function scanExpressionRoot(expression: TypedExpr): Void {
    expressionRoots++;
    scanExpression(expression);
  }

  function scanExpression(expression: TypedExpr): Void {
    expressionNodes++;
    scanTypeRoot(expression.t);
    switch expression.expr {
      case TFor(variable, _, _) | TVar(variable, _):
        scanTypeRoot(variable.t);
      case TFunction(fn):
        scanTypeRoot(fn.t);
        for (argument in fn.args) {
          scanTypeRoot(argument.v.t);
          if (argument.value != null)
            scanExpressionRoot(argument.value);
        }
      case TTry(_, catches):
        for (entry in catches)
          scanTypeRoot(entry.v.t);
      default:
    }
    expression.iter(scanExpression);
  }

  function scanTypeRoot(type: Null<Type>): Void {
    if (type == null)
      return;
    typeRoots++;
    scanType(type);
  }

  function scanTypeParameter(parameter: TypeParameter): Void {
    scanTypeRoot(parameter.t);
    scanTypeRoot(parameter.defaultType);
  }

  function scanType(type: Null<Type>): Void {
    if (type == null)
      return;
    typeNodes++;
    switch type {
      case TMono(reference):
        scanType(reference.get());
      case TEnum(_, parameters) | TInst(_, parameters) |
        TType(_, parameters) | TAbstract(_, parameters):
        for (parameter in parameters)
          scanType(parameter);
      case TFun(arguments, result):
        for (argument in arguments)
          scanType(argument.t);
        scanType(result);
      case TAnonymous(reference):
        for (field in reference.get().fields)
          scanType(field.type);
      case TDynamic(inner):
        scanType(inner);
      case TLazy(resolve):
        scanType(resolve());
    }
  }
}
#end
