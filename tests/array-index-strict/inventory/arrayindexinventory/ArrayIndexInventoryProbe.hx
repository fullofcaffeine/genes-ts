package arrayindexinventory;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import genes.ts.TsIndexedAccessPlan;

using haxe.macro.TypedExprTools;

/**
 * Installs exact typed-tree controls for the indexed-access shadow plan.
 *
 * Why: Haxe rejects logical assignment in source and erases several harmless
 * target wrappers while typing. Source-only fixtures therefore cannot prove
 * that Genes classifies the final typed forms which its emitter will receive.
 *
 * What: the default probe converts five valid placeholder assignments into
 * logical assignments or wrapped arithmetic targets. A named negative mode
 * converts one additional placeholder into a deliberately unsupported typed
 * form and expects the production plan to stop with its stable diagnostic.
 *
 * How: `onAfterTyping` obtains typed copies of the placeholder methods, changes
 * those copies, and passes them to the production classifier. It never edits
 * the compiler-owned program. The normal inventory separately proves the full
 * request-local plan over the real final typed module.
 */
class ArrayIndexInventoryProbe {
  static final OWNER_MODULE = "arrayindexinventory.Main";

  public static macro function install(): Expr {
    final mode = Context.definedValue("genes.ts.indexed_access_probe");
    Context.onAfterTyping(types -> inspect(types,
      mode == null ? "positive" : mode));
    return macro null;
  }

  static function inspect(types: Array<ModuleType>, mode: String): Void {
    final fields = new Map<String, ClassField>();
    for (type in types)
      switch type {
        case TClassDecl(reference) if (reference.get().module == OWNER_MODULE):
          for (field in reference.get().statics.get())
            fields.set(field.name, field);
        default:
      }

    probe(fields, "typedLogicalAnd",
      operation -> replaceOperator(operation, OpAssignOp(OpBoolAnd)));
    probe(fields, "typedLogicalOr",
      operation -> replaceOperator(operation, OpAssignOp(OpBoolOr)));
    probe(fields, "typedParenthesis",
      operation -> wrapTarget(operation,
        target -> typed(TParenthesis(target), target)));
    probe(fields, "typedMetadata",
      operation -> wrapTarget(operation, target -> typed(TMeta({
        name: ":indexedInventory",
        params: [],
        pos: target.pos
      }, target), target)));
    probe(fields, "typedImplicitCast",
      operation -> wrapTarget(operation,
        target -> typed(TCast(target, null), target)));
    probe(fields, "typedRegistryWrite",
      operation -> replaceDirectRegistryReceiver(operation, "$hxClasses"));
    probeRead(fields, "typedRegistryRead", read -> {
      replaceDirectRegistryRead(read, "$hxEnums");
      read.t = Context.makeMonomorph();
    });
    probeEnumParameterRead(fields, "typedEnumParameterRead", "value", "value");
    switch mode {
      case "positive":
      case "undefined-arithmetic":
        reject(fields, "rejectedUndefined",
          operation -> replaceOperator(operation, OpAssignOp(OpAdd)));
      case "unknown-arithmetic":
        reject(fields, "rejectedUnknown",
          operation -> replaceOperator(operation, OpAssignOp(OpAdd)));
      case "generic-arithmetic":
        reject(fields, "rejectedGeneric",
          operation -> replaceOperator(operation, OpAssignOp(OpAdd)));
      case "unresolved-write":
        reject(fields, "rejectedUnresolved",
          operation -> indexedTarget(operation).t = Context.makeMonomorph());
      case "unresolved-target":
        reject(fields, "rejectedUnresolved", operation -> {
          replaceOperator(operation, OpAssignOp(OpAdd));
          indexedTarget(operation).t = Context.makeMonomorph();
        });
      case "unresolved-read":
        rejectRead(fields, "rejectedUnresolved",
          operation -> indexedTarget(operation).t = Context.makeMonomorph());
      case "undefined-receiver":
        rejectRead(fields, "rejectedUndefinedReceiver",
          operation -> indexedReceiver(operation).t = argumentType(fields,
            "rejectedUndefinedReceiver", "boundary"));
      case "unknown-receiver":
        rejectRead(fields, "rejectedUnknownReceiver",
          operation -> indexedReceiver(operation).t = argumentType(fields,
            "rejectedUnknownReceiver", "boundary"));
      case "syntax-metadata":
        reject(fields, "rejectedMetadata", operation -> {
          replaceOperator(operation, OpAssignOp(OpAdd));
          wrapTarget(operation, target -> typed(TMeta({
            name: ":loopLabel",
            params: [],
            pos: target.pos
          }, target), target));
        });
      case "explicit-cast":
        reject(fields, "rejectedExplicitCast", operation -> {
          replaceOperator(operation, OpAssignOp(OpAdd));
          final castType: ModuleType = switch Context.getType("Int") {
            case TAbstract(reference, _): ModuleType.TAbstract(reference);
            default: Context.error("expected the built-in Int abstract",
                operation.pos);
          };
          wrapTarget(operation,
            target -> typed(TCast(target, castType), target));
        });
      case "unsupported-operator":
        reject(fields, "rejectedOperator",
          operation -> replaceOperator(operation, OpAssignOp(OpInterval)));
      case "registry-compound":
        reject(fields, "rejectedRegistryCompound", operation -> {
          replaceOperator(operation, OpAssignOp(OpAdd));
          replaceDirectRegistryReceiver(operation, "$hxClasses");
        });
      case "registry-nested":
        reject(fields, "rejectedRegistryNested", operation -> {
          replaceNestedRegistryReceiver(operation, "$hxEnums");
          indexedTarget(operation).t = Context.makeMonomorph();
        });
      case "registry-read-explicit-cast":
        rejectIndexedRead(fields, "rejectedRegistryReadCast", read -> {
          replaceExplicitCastRegistryRead(read, "$hxEnums");
          read.t = Context.makeMonomorph();
        });
      case "enum-parameter-other-read":
        rejectEnumParameterRead(fields, "typedEnumParameterRead", "other",
          "value");
      default:
        Context.error('unknown indexed-access probe mode "$mode"',
          Context.currentPos());
    }
  }

  static function probe(fields: Map<String, ClassField>, name: String,
      transform: TypedExpr->Void): Void {
    final operation = operation(fields, name);
    transform(operation);
    Context.info("[GTS-INDEX-PROBE] "
      + TsIndexedAccessPlan.probeTypedOperation(operation),
      operation.pos);
  }

  static function reject(fields: Map<String, ClassField>, name: String,
      transform: TypedExpr->Void): Void {
    final operation = operation(fields, name);
    transform(operation);
    TsIndexedAccessPlan.probeTypedOperation(operation);
    Context.error('typed negative probe "$name" was accepted', operation.pos);
  }

  static function rejectRead(fields: Map<String, ClassField>, name: String,
      transform: TypedExpr->Void): Void {
    final sourceOperation = operation(fields, name);
    transform(sourceOperation);
    final read = indexedTarget(sourceOperation);
    TsIndexedAccessPlan.probeTypedRead(read);
    Context.error('typed negative read probe "$name" was accepted', read.pos);
  }

  static function probeRead(fields: Map<String, ClassField>, name: String,
      transform: TypedExpr->Void): Void {
    final read = indexedRead(fields, name);
    transform(read);
    Context.info("[GTS-INDEX-PROBE] "
      + TsIndexedAccessPlan.probeTypedRead(read),
      read.pos);
  }

  static function rejectIndexedRead(fields: Map<String, ClassField>,
      name: String, transform: TypedExpr->Void): Void {
    final read = indexedRead(fields, name);
    transform(read);
    TsIndexedAccessPlan.probeTypedRead(read);
    Context.error('typed negative read probe "$name" was accepted', read.pos);
  }

  static function probeEnumParameterRead(fields: Map<String, ClassField>,
      fieldName: String, receiverName: String, parameterName: String): Void {
    final read = indexedReadForReceiver(fields, fieldName, receiverName);
    read.t = Context.makeMonomorph();
    final parameter = argumentVariable(fields, fieldName, parameterName);
    Context.info("[GTS-INDEX-PROBE] "
      + TsIndexedAccessPlan.probeHaxeEnumParameterRead(read, parameter),
      read.pos);
  }

  static function rejectEnumParameterRead(fields: Map<String, ClassField>,
      fieldName: String, receiverName: String, parameterName: String): Void {
    final read = indexedReadForReceiver(fields, fieldName, receiverName);
    read.t = Context.makeMonomorph();
    final parameter = argumentVariable(fields, fieldName, parameterName);
    TsIndexedAccessPlan.probeHaxeEnumParameterRead(read, parameter);
    Context.error('typed negative enum-parameter read "$receiverName" was accepted',
      read.pos);
  }

  static function operation(fields: Map<String, ClassField>,
      name: String): TypedExpr {
    final field = fields.get(name);
    if (field == null || field.expr() == null)
      Context.error('missing typed probe method "$name"', Context.currentPos());
    var changed = false;
    function visit(expression: TypedExpr): Null<TypedExpr> {
      if (!changed && switch expression.expr {
          case TBinop(OpAssign, _, _): true;
          default: false;
        }) {
        changed = true;
        return expression;
        }
      for (child in children(expression)) {
        final found = visit(child);
        if (found != null)
          return found;
      }
      return null;
    }
    final found = visit(field.expr());
    if (!changed || found == null)
      Context.error('typed probe method "$name" has no placeholder assignment',
        field.pos);
    return found;
  }

  static function children(expression: TypedExpr): Array<TypedExpr> {
    final values = new Array<TypedExpr>();
    expression.iter(values.push);
    return values;
  }

  static function indexedRead(fields: Map<String, ClassField>,
      name: String): TypedExpr {
    final field = fields.get(name);
    if (field == null || field.expr() == null)
      Context.error('missing typed read probe method "$name"',
        Context.currentPos());
    function visit(expression: TypedExpr): Null<TypedExpr> {
      switch expression.expr {
        case TArray(_, _):
          return expression;
        default:
      }
      for (child in children(expression)) {
        final found = visit(child);
        if (found != null)
          return found;
      }
      return null;
    }
    final found = visit(field.expr());
    return
      found == null ? Context.error('typed probe method "$name" has no indexed read',
        field.pos) : found;
  }

  static function indexedReadForReceiver(fields: Map<String, ClassField>,
      fieldName: String, receiverName: String): TypedExpr {
    final receiver = argumentVariable(fields, fieldName, receiverName);
    final field = fields.get(fieldName);
    function visit(expression: TypedExpr): Null<TypedExpr> {
      switch expression.expr {
        case TArray({expr: TLocal(variable)}, _)
          if (variable.id == receiver.id):
          return expression;
        default:
      }
      for (child in children(expression)) {
        final found = visit(child);
        if (found != null)
          return found;
      }
      return null;
    }
    final found = visit(field.expr());
    return
      found == null ? Context.error('typed probe method "$fieldName" has no indexed read for "$receiverName"',
      field.pos) : found;
  }

  static function replaceOperator(operation: TypedExpr, binop: Binop): Void {
    switch operation.expr {
      case TBinop(OpAssign, target, rhs):
        operation.expr = TBinop(binop, target, rhs);
      default:
        Context.error("typed probe expected a plain assignment", operation.pos);
    }
  }

  static function wrapTarget(operation: TypedExpr,
      wrapper: TypedExpr->TypedExpr): Void {
    switch operation.expr {
      case TBinop(binop, target, rhs):
        operation.expr = TBinop(binop, wrapper(target), rhs);
      default:
        Context.error("typed probe expected an assignment", operation.pos);
    }
  }

  static function indexedTarget(operation: TypedExpr): TypedExpr {
    return switch operation.expr {
      case TBinop(_, target, _): target;
      default: Context.error("typed probe expected an indexed target",
          operation.pos);
    }
  }

  static function indexedReceiver(operation: TypedExpr): TypedExpr {
    return switch indexedTarget(operation).expr {
      case TArray(receiver, _): receiver;
      default: Context.error("typed probe expected an indexed target",
          operation.pos);
    }
  }

  static function replaceDirectRegistryReceiver(operation: TypedExpr,
      name: String): Void {
    replaceDirectRegistryRead(indexedTarget(operation), name);
    indexedTarget(operation).t = Context.makeMonomorph();
  }

  static function replaceDirectRegistryRead(read: TypedExpr,
      name: String): Void {
    switch read.expr {
      case TArray(receiver, index):
        read.expr = TArray(typed(TIdent(name), receiver), index);
      default:
        Context.error("typed probe expected an indexed read", read.pos);
    }
  }

  static function replaceNestedRegistryReceiver(operation: TypedExpr,
      name: String): Void {
    switch indexedTarget(operation).expr {
      case TArray(inner = {expr: TArray(receiver, index)}, _):
        inner.expr = TArray(typed(TIdent(name), receiver), index);
      default:
        Context.error("typed probe expected a nested indexed target",
          operation.pos);
    }
  }

  static function replaceExplicitCastRegistryRead(read: TypedExpr,
      name: String): Void {
    final castType: ModuleType = switch Context.getType("Int") {
      case TAbstract(reference, _): ModuleType.TAbstract(reference);
      default: Context.error("expected the built-in Int abstract", read.pos);
    };
    switch read.expr {
      case TArray(receiver, index):
        final registry = typed(TIdent(name), receiver);
        read.expr = TArray(typed(TCast(registry, castType), receiver), index);
      default:
        Context.error("typed probe expected an indexed read", read.pos);
    }
  }

  static function argumentType(fields: Map<String, ClassField>,
      fieldName: String, argumentName: String): Type {
    final field = fields.get(fieldName);
    return switch field == null ? null : field.expr() {
      case {expr: TFunction(functionValue)}:
        for (argument in functionValue.args)
          if (argument.v.name == argumentName)
            return argument.v.t;
        Context.error('typed probe method "$fieldName" has no "$argumentName" argument',
          field.pos);
      default:
        Context.error('typed probe method "$fieldName" is not a function',
          field == null ? Context.currentPos() : field.pos);
    }
  }

  static function argumentVariable(fields: Map<String, ClassField>,
      fieldName: String, argumentName: String): TVar {
    final field = fields.get(fieldName);
    return switch field == null ? null : field.expr() {
      case {expr: TFunction(functionValue)}:
        for (argument in functionValue.args)
          if (argument.v.name == argumentName)
            return argument.v;
        Context.error('typed probe method "$fieldName" has no "$argumentName" argument',
          field.pos);
      default:
        Context.error('typed probe method "$fieldName" is not a function',
          field == null ? Context.currentPos() : field.pos);
    }
  }

  static function typed(definition: TypedExprDef,
      source: TypedExpr): TypedExpr {
    return {
      expr: definition,
      pos: source.pos,
      t: source.t
    };
  }
}
#end
