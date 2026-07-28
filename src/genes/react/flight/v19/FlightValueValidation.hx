package genes.react.flight.v19;

#if macro
import haxe.macro.Type;
import haxe.macro.Type.DefType;
import haxe.macro.Expr.Position;

using haxe.macro.TypeTools;

private inline final FLIGHT_V19_PACKAGE = "genes.react.flight.v19";

private final FLIGHT_V19_SCALARS = [
  "FlightDate",
  "FlightArrayBuffer",
  "FlightInt8Array",
  "FlightInt16Array",
  "FlightInt32Array",
  "FlightUint8Array",
  "FlightUint8ClampedArray",
  "FlightUint16Array",
  "FlightUint32Array",
  "FlightFloat32Array",
  "FlightFloat64Array"
];

private enum FlightExtensionResult {
  NotHandled;
  Handled(issue: Null<FlightValidationIssue>);
}

private function issue(kind: FlightValidationKind, path: String, type: Type,
    reason: String, position: Null<Position>): FlightValidationIssue {
  return {
    kind: kind,
    path: path,
    type: type,
    reason: reason,
    position: position
  };
}

private function typeIdentity(type: Type): String {
  return switch type {
    case TInst(reference, parameters):
      final value = reference.get();
      '${value.module}.${value.name}<${parameters.map(typeIdentity).join(",")}>';
    case TEnum(reference, parameters):
      final value = reference.get();
      '${value.module}.${value.name}<${parameters.map(typeIdentity).join(",")}>';
    case TType(reference, parameters):
      final value = reference.get();
      '${value.module}.${value.name}<${parameters.map(typeIdentity).join(",")}>';
    case TAbstract(reference, parameters):
      final value = reference.get();
      '${value.module}.${value.name}<${parameters.map(typeIdentity).join(",")}>';
    case TAnonymous(_): "anonymous";
    case TFun(_, _): "function";
    case TDynamic(_): "dynamic";
    case TMono(reference):
      final value = reference.get();
      value == null ? "monomorph" : typeIdentity(value);
    case TLazy(resolve): typeIdentity(resolve());
  };
}

private function isNamed(type: Type, module: String, name: String): Bool {
  return switch type {
    case TType(reference, parameters): final value = reference.get(); (value.module == module
        && value.name == name && parameters.length == 0) || isNamed(value.type.applyTypeParameters(value.params,
        parameters), module,
        name);
    case TAbstract(reference, parameters): final value = reference.get(); value.module == module && value.name == name && parameters.length == 0;
    case TInst(reference, parameters): final value = reference.get(); value.module == module && value.name == name && parameters.length == 0;
    case TMono(reference): final value = reference.get(); value != null && isNamed(value,
        module, name);
    case TLazy(resolve):
      isNamed(resolve(), module, name);
    case _:
      false;
  };
}

private function isPrimitive(type: Type): Bool {
  return switch type {
    case TInst(reference, parameters): final value = reference.get(); value.module == "String" && value.name == "String" && parameters.length == 0;
    case TAbstract(reference, parameters): final value = reference.get(); value.module == "StdTypes" && ["Bool", "Int", "Float"].contains(value.name) && parameters.length == 0;
    case TType(reference, parameters):
      final value = reference.get();
      isPrimitive(value.type.applyTypeParameters(value.params, parameters));
    case TMono(reference): final value = reference.get(); value != null && isPrimitive(value);
    case TLazy(resolve):
      isPrimitive(resolve());
    case _:
      false;
  };
}

private function pathField(path: String, name: String): String {
  return path == "" ? name : '$path.$name';
}

private function isFlightV19Typedef(type: DefType, name: String,
    parameters: Array<Type>, arity: Int): Bool {
  return type.pack.join(".") == FLIGHT_V19_PACKAGE
    && type.module == '$FLIGHT_V19_PACKAGE.$name'
    && type.name == name
    && parameters.length == arity;
}

private function visitExtension(type: Type, path: String,
    active: Array<String>, extension: Null<FlightExtensionPolicy>,
    position: Null<Position>): FlightExtensionResult {
  if (extension == null) {
    return NotHandled;
  }
  return switch extension(type, path) {
    case Unhandled:
      NotHandled;
    case Accept:
      // `Accept` is a compile-time provenance decision by the host macro;
      // it does not manufacture, wrap, or inspect a runtime value.
      Handled(null);
    case Reject(reason):
      Handled(issue(HostRejected, path, type, reason, position));
    case Recurse(values):
      if (values.length == 0) {
        Handled(issue(HostRejected, path, type,
          "the host extension supplied no nested values; use Accept for a payload-free capability.",
          position));
      } else {
        final identity = typeIdentity(type);
        if (active.contains(identity)) {
          Handled(issue(RecursiveValue, path, type,
            "recursive or cyclic host capability graphs are rejected conservatively.",
            position));
        } else {
          active.push(identity);
          var nestedIssue: Null<FlightValidationIssue> = null;
          for (value in values) {
            if (nestedIssue == null) {
              nestedIssue = visit(value.type, value.path, active, extension,
                value.position == null ? position : value.position);
            }
          }
          active.pop();
          Handled(nestedIssue);
        }
      }
  };
}

private function visit(type: Type, path: String, active: Array<String>,
    extension: Null<FlightExtensionPolicy>,
    position: Null<Position>): Null<FlightValidationIssue> {
  if (isPrimitive(type) || isNamed(type, "genes.react.Node", "Node")
    || isNamed(type, "genes.react.Element", "Element")) {
    return null;
  }

  return switch type {
    case TMono(reference):
      final value = reference.get();
      value == null ? issue(UnresolvedType, path, type,
        "the type is not concrete at the boundary.",
        position) : visit(value, path, active, extension, position);
    case TLazy(resolve):
      visit(resolve(), path, active, extension, position);
    case TType(reference, parameters):
      final definition = reference.get();
      if (FLIGHT_V19_SCALARS.contains(definition.name)
        && isFlightV19Typedef(definition, definition.name, parameters, 0)) {
        null;
      } else if (isFlightV19Typedef(definition, "FlightSet", parameters, 1)) {
        visit(parameters[0], path + ".values[]", active, extension, position);
      } else {
        final identity = typeIdentity(type);
        if (active.contains(identity)) {
          issue(RecursiveValue, path, type,
            "recursive or cyclic value graphs are rejected conservatively.",
            position);
        } else {
          active.push(identity);
          final nestedIssue = visit(definition.type.applyTypeParameters(definition.params,
            parameters),
            path, active, extension, position);
          active.pop();
          nestedIssue;
        }
      }
    case TAbstract(reference, parameters):
      final definition = reference.get();
      if (definition.pack.join(".") == FLIGHT_V19_PACKAGE
        && definition.module == '$FLIGHT_V19_PACKAGE.FlightGlobalSymbol'
        && definition.name == "FlightGlobalSymbol"
        && parameters.length == 0) {
        null;
      } else if (definition.module == "StdTypes"
        && definition.name == "Null" && parameters.length == 1) {
        visit(parameters[0], path, active, extension, position);
      } else if (definition.module == "genes.ts.Undefinable"
        && definition.name == "Undefinable" && parameters.length == 1) {
        visit(parameters[0], path, active, extension, position);
      } else if (definition.name == "Any"
        || (definition.module == "genes.ts.Unknown"
          && definition.name == "Unknown")) {
        issue(BroadExternalValue, path, type,
          "broad external-boundary values must be decoded before transport.",
          position);
      } else {
        final extensionResult = visitExtension(type, path, active, extension,
          position);
        switch extensionResult {
          case Handled(extensionIssue):
            extensionIssue;
          case NotHandled:
            final underlying = definition.type.applyTypeParameters(definition.params,
              parameters);
            isPrimitive(underlying) ? null : issue(UnsupportedAbstract, path,
              type,
              "only abstracts represented by a string, number, or boolean are supported.",
              position);
        }
      }
    case TInst(reference, parameters):
      final definition = reference.get();
      if (definition.pack.join(".") == FLIGHT_V19_PACKAGE
        && definition.module == '$FLIGHT_V19_PACKAGE.FlightMap'
        && definition.name == "FlightMap"
        && parameters.length == 2) {
        final keyIssue = visit(parameters[0], path + ".keys[]", active,
          extension, position);
        keyIssue != null ? keyIssue : visit(parameters[1], path + ".values[]",
          active, extension, position);
      } else if (definition.module == "Array" && parameters.length == 1) {
        visit(parameters[0], path + "[]", active, extension, position);
      } else if (definition.module == "js.lib.Promise"
        && definition.name == "Promise") {
        issue(RawPromise, path, type,
          "an ordinary Promise does not prove stable host ownership or React transport provenance.",
          position);
      } else if (definition.module == "js.lib.Symbol"
        && definition.name == "Symbol") {
        issue(RawSymbol, path, type,
          "a raw symbol does not prove global-registry provenance; use FlightGlobalSymbol.forKey(...).",
          position);
      } else {
        final extensionResult = visitExtension(type, path, active, extension,
          position);
        switch extensionResult {
          case Handled(extensionIssue):
            extensionIssue;
          case NotHandled:
            issue(UnsupportedClass, path, type,
              "class instances and unreviewed runtime containers do not have a stable Flight encoding.",
              position);
        }
      }
    case TAnonymous(reference):
      var fieldIssue: Null<FlightValidationIssue> = null;
      for (field in reference.get().fields) {
        if (fieldIssue == null) {
          fieldIssue = visit(field.type, pathField(path, field.name), active,
            extension, field.pos);
        }
      }
      fieldIssue;
    case TFun(_, _):
      issue(OrdinaryFunction, path, type,
        "ordinary functions are not React transport values.", position);
    case TEnum(_, _):
      issue(RuntimeEnum, path, type,
        "runtime Haxe enum instances are not plain transport records; use a string or number enum abstract.",
        position);
    case TDynamic(_):
      issue(DynamicValue, path, type,
        "a broad dynamic value must be decoded into a closed model first.",
        position);
  };
}

/**
 * Validates a closed Haxe type against the React 19 Flight value algebra.
 *
 * Why: React hosts need one precise, reusable compiler contract rather than
 * duplicating subtly different serializability walkers.
 *
 * What: primitives, renderable React nodes, arrays, closed anonymous
 * records, null/undefined, primitive-represented abstracts, and the exact
 * versioned Flight capabilities in this package are accepted recursively.
 * Broad values, raw Promises/functions/symbols, runtime enums, and unknown
 * class instances fail closed.
 *
 * How: a host may supply an extension policy for its own provenance-bearing
 * nominal types. The policy can accept the capability, reject it with a
 * reason, or ask Genes to recurse into nested payload types. The returned
 * issue contains no framework vocabulary or diagnostic code.
 */
function validateFlightValue(type: Type, root: String,
    ?extension: FlightExtensionPolicy,
    ?position: Position): Null<FlightValidationIssue> {
  return visit(type, root, [], extension, position);
}
#end
