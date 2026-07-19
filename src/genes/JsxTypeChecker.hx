package genes;

import genes.JsxPlan.JsxChildIntent;
import genes.JsxPlan.JsxIntent;
import genes.JsxPlan.JsxPropIntent;
import genes.JsxPlan.JsxTagIntent;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.TypeTools;

private typedef JsxPropField = {
  var name: String;
  var type: Type;
  var optional: Bool;
  var pos: Position;
}

private typedef JsxPropSchema = {
  var fields: Map<String, JsxPropField>;
}

private typedef JsxPrefixContract = {
  var prefix: String;
  var type: Type;
  var pos: Position;
}

private typedef JsxIntrinsicContract = {
  var name: String;
  var schema: JsxPropSchema;
  var prefixes: Array<JsxPrefixContract>;
  var pos: Position;
}

private typedef JsxComponentContract = {
  var schema: JsxPropSchema;
  var bindings: Map<String, Type>;
}

private typedef JsxStringMetadata = {
  var value: String;
  var pos: Position;
}

/**
 * Checks HXX tags, properties, callbacks, spreads, and children in Haxe.
 *
 * Why: generated TypeScript is too late to be the first place a Haxe author
 * learns that `<Button label={42} />` is invalid. Classic JavaScript also has
 * no later type checker at all.
 *
 * What: this checker reads the real types attached to the typed Haxe tree and
 * compares them with component or intrinsic-element property contracts. It
 * rejects unsafe or unresolved values instead of silently widening them.
 *
 * How: `JsxPlan` keeps one ordered, target-neutral description of the markup.
 * This class validates that description once before any `.tsx`, `.jsx`, `.ts`,
 * or `.js` printer runs. TypeScript remains a separate consumer-side parity
 * check; it is not parsed or consulted during an ordinary Haxe compilation.
 */
class JsxTypeChecker {
  static final DEFAULT_INTRINSIC_PROVIDER = 'genes.react.IntrinsicElements';

  final intrinsics: Map<String, JsxIntrinsicContract> = [];

  public function new() {
    loadIntrinsicProviders();
  }

  public function validate(intent: JsxIntent): Void {
    switch intent {
      case ElementIntent(tag, props, children, _):
        switch tag {
          case IntrinsicTag(name, expression):
            final contract = intrinsics.get(name);
            if (contract == null)
              fail('GTS-HXX-TAG-001',
                'Unknown intrinsic tag `<$name>`. ' +
                'Add it to a typed intrinsic provider or correct the tag name',
                expression.pos);
            validateProps('<$name>', contract.schema, contract.prefixes,
              props, children, [], expression.pos);
          case ComponentTag(expression):
            final contract = componentContract(expression);
            validateProps('component `${componentName(expression)}`',
              contract.schema, [], props, children, contract.bindings,
              expression.pos);
          case DynamicIntrinsicTag(_):
            // The low-level internal marker retains runtime-string support for
            // compiler migrations. HXX source itself always has a static tag.
            validateDynamicMarker(props, children);
        }
      case FragmentIntent(children, _):
        validateRenderableChildren('fragment', children);
    }
  }

  function validateProps(label: String, schema: JsxPropSchema,
      acceptedPrefixes: Array<JsxPrefixContract>, props: Array<JsxPropIntent>,
      children: Array<JsxChildIntent>, bindings: Map<String, Type>,
      tagPos: Position): Void {
    final provided: Map<String, Bool> = [];
    var namedChildren = false;

    for (prop in props) {
      switch prop {
        case NamedProp(name, value, _):
          if (provided.exists(name))
            fail('GTS-HXX-PROP-003', '$label provides `$name` more than once',
              value.pos);
          provided.set(name, true);
          if (name == 'children')
            namedChildren = true;
          final field = schema.fields.get(name);
          if (field != null) {
            requireAssignable(value.t, field.type, bindings, field.optional,
              'GTS-HXX-PROP-002',
              '$label property `$name` expects `${typeName(field.type)}` but ' +
              'received `${typeName(value.t)}`',
              value.pos);
          } else if (name == 'key') {
            if (!isKey(value.t))
              fail('GTS-HXX-PROP-002',
                '$label property `key` expects ' +
                '`String | Int` but received `${typeName(value.t)}`',
                value.pos);
          } else {
            final prefix = matchingPrefix(name, acceptedPrefixes);
            if (prefix == null)
              fail('GTS-HXX-PROP-001',
                '$label does not declare a `$name` ' + 'property', value.pos);
            requireAssignable(value.t, prefix.type, bindings, true,
              'GTS-HXX-PROP-002',
              '$label prefixed property `$name` expects ' +
              '`${typeName(prefix.type)}` but received ' +
              '`${typeName(value.t)}`',
              value.pos);
          }
        case SpreadProp(expression, _):
          final spread = spreadSchema(expression.t, expression.pos);
          for (name => actual in spread.fields) {
            if (provided.exists(name))
              fail('GTS-HXX-PROP-003',
                '$label provides `$name` more than ' +
                'once after expanding this spread',
                expression.pos);
            provided.set(name, !actual.optional);
            if (name == 'children')
              namedChildren = true;
            final expected = schema.fields.get(name);
            if (expected != null) {
              requireAssignable(actual.type, expected.type,
                bindings, actual.optional || expected.optional,
                'GTS-HXX-SPREAD-002',
                '$label spread property `$name` expects ' +
                '`${typeName(expected.type)}` but received ' +
                '`${typeName(actual.type)}`',
                expression.pos);
            } else if (name == 'key') {
              if (!isKey(actual.type))
                fail('GTS-HXX-SPREAD-002',
                  '$label spread property `key` ' +
                  'expects `String | Int` but received ' +
                  '`${typeName(actual.type)}`',
                  expression.pos);
            } else {
              final prefix = matchingPrefix(name, acceptedPrefixes);
              if (prefix == null)
                fail('GTS-HXX-SPREAD-003',
                  '$label spread contains unknown ' + 'property `$name`',
                  expression.pos);
              requireAssignable(actual.type, prefix.type, bindings,
                actual.optional, 'GTS-HXX-SPREAD-002',
                '$label spread property `$name` expects ' +
                '`${typeName(prefix.type)}` but received ' +
                '`${typeName(actual.type)}`',
                expression.pos);
            }
          }
      }
    }

    if (namedChildren && children.length > 0)
      fail('GTS-HXX-CHILD-004',
        '$label cannot combine a `children` property ' +
        'with nested HXX children',
        childExpression(children[0]).pos);

    final childField = schema.fields.get('children');
    if (!namedChildren)
      validateNestedChildren(label, childField, children, bindings, tagPos);

    for (name => field in schema.fields) {
      if (field.optional || name == 'children')
        continue;
      if (!provided.exists(name) || !provided.get(name))
        fail('GTS-HXX-PROP-004',
          '$label is missing required property `$name`', tagPos);
    }
  }

  function validateNestedChildren(label: String, field: Null<JsxPropField>,
      children: Array<JsxChildIntent>, bindings: Map<String, Type>,
      tagPos: Position): Void {
    if (field == null) {
      if (children.length > 0)
        fail('GTS-HXX-CHILD-001', '$label does not accept nested children',
          childExpression(children[0]).pos);
      return;
    }
    if (children.length == 0) {
      if (!field.optional)
        fail('GTS-HXX-CHILD-002',
          '$label requires a child compatible with ' +
          '`${typeName(field.type)}`',
          tagPos);
      return;
    }

    final expected = substitute(field.type, bindings);
    if (isNodeContract(expected)) {
      validateRenderableChildren(label, children);
      return;
    }
    final elementType = arrayElement(expected);
    if (elementType != null) {
      for (child in children) {
        final expression = childExpression(child);
        requireAssignable(expression.t, elementType, bindings, false,
          'GTS-HXX-CHILD-003',
          '$label child expects ' +
          '`${typeName(elementType)}` but received ' +
          '`${typeName(expression.t)}`',
          expression.pos);
      }
      return;
    }
    if (children.length != 1)
      fail('GTS-HXX-CHILD-003',
        '$label accepts one child of type ' +
        '`${typeName(expected)}`, not ${children.length} children',
        childExpression(children[1]).pos);
    final expression = childExpression(children[0]);
    requireAssignable(expression.t, expected, bindings, false,
      'GTS-HXX-CHILD-003',
      '$label child expects `${typeName(expected)}` ' +
      'but received `${typeName(expression.t)}`',
      expression.pos);
  }

  function validateDynamicMarker(props: Array<JsxPropIntent>,
      children: Array<JsxChildIntent>): Void {
    for (prop in props) {
      switch prop {
        case NamedProp(_, value, _):
          rejectUnsafe(value.t, value.pos);
        case SpreadProp(expression, _):
          spreadSchema(expression.t, expression.pos);
      }
    }
    validateRenderableChildren('dynamic intrinsic marker', children);
  }

  function validateRenderableChildren(label: String,
      children: Array<JsxChildIntent>): Void {
    for (child in children) {
      final expression = childExpression(child);
      if (!isRenderable(expression.t, 0))
        fail('GTS-HXX-CHILD-003',
          '$label cannot render a child of type ' +
          '`${typeName(expression.t)}`',
          expression.pos);
    }
  }

  function componentContract(expression: TypedExpr): JsxComponentContract {
    final original = resolveAliases(expression.t);
    return switch original {
      case TFun(arguments, result):
        if (arguments.length > 1)
          fail('GTS-HXX-TAG-002',
            'Component `${componentName(expression)}` ' +
            'must accept zero or one property argument, not ' +
            '${arguments.length}',
            expression.pos);
        if (!isComponentResult(result))
          fail('GTS-HXX-TAG-003',
            'Component `${componentName(expression)}` ' +
            'returns `${typeName(result)}`; HXX components must return a ' +
            'React node or `Promise` of one',
            expression.pos);
        final schema = arguments.length == 0 ? {
          fields: new Map<String, JsxPropField>()
        } : propSchema(arguments[0].t, expression.pos,
          'component `${componentName(expression)}` properties');
        {schema: schema, bindings: new Map<String, Type>()};
      case TInst(classRef, parameters)
        if (hasMeta(classRef.get().meta, 'genes.jsxComponentProps')):
        componentContractFromMetadata(classRef.get(), parameters,
          expression.pos);
      case TInst(classRef, [TInst(componentRef, parameters)])
        if (classRef.get().pack.length == 0
          && classRef.get().name == 'Class'
          && hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
        componentContractFromMetadata(componentRef.get(), parameters,
          expression.pos);
      case TAbstract(classRef, [TInst(componentRef, parameters)])
        if (classRef.get().pack.length == 0
          && classRef.get().name == 'Class'
          && hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
        componentContractFromMetadata(componentRef.get(), parameters,
          expression.pos);
      case TAbstract(abstractRef, parameters)
        if (hasMeta(abstractRef.get().meta, 'genes.jsxComponentProps')):
        componentContractFromMetadata(abstractRef.get(), parameters,
          expression.pos);
      case TAnonymous(anonymous):
        switch anonymous.get().status {
          case AClassStatics(componentRef)
            if (hasMeta(componentRef.get().meta, 'genes.jsxComponentProps')):
            componentContractFromMetadata(componentRef.get(), [],
              expression.pos);
          default:
            failInvalidComponent(expression);
        }
      default:
        failInvalidComponent(expression);
    }
  }

  function failInvalidComponent(expression: TypedExpr): JsxComponentContract {
    return fail('GTS-HXX-TAG-002',
      '`${componentName(expression)}` has type ' +
      '`${typeName(expression.t)}`, which is not a callable component or ' +
      'a type annotated with `@:genes.jsxComponentProps(indexOrTypePath)`',
      expression.pos);
  }

  function componentContractFromMetadata(base: BaseType,
      parameters: Array<Type>, pos: Position): JsxComponentContract {
    final propsType = componentPropsMetadataType(base, parameters, pos);
    return {
      schema: propSchema(propsType, pos, '${base.name} properties'),
      bindings: new Map<String, Type>()
    };
  }

  function componentPropsMetadataType(base: BaseType, parameters: Array<Type>,
      pos: Position): Type {
    final entries = metadata(base.meta, 'genes.jsxComponentProps');
    return switch entries {
      case [{params: [{expr: EConst(CInt(value, _))}]}]:
        final index = Std.parseInt(value);
        if (index == null || index < 0 || index >= parameters.length)
          fail('GTS-HXX-TAG-004',
            '${base.name} declares property parameter index ' +
            '$value but has ${parameters.length} type parameters',
            pos);
        parameters[index];
      case [{params: [{expr: EConst(CString(path, _))}]}]
        if (StringTools.trim(path).length > 0):
        Context.getType(path);
      default:
        fail('GTS-HXX-SCHEMA-006',
          '@:genes.jsxComponentProps expects one generic-parameter index ' +
          'or one fully qualified property-type path string',
          pos);
    }
  }

  function propSchema(type: Type, pos: Position, label: String): JsxPropSchema {
    final fields = objectFields(type, false, 0);
    if (fields == null)
      fail('GTS-HXX-TAG-005',
        '$label must be a closed anonymous structure or ' +
        'an extern/interface property contract; received `${typeName(type)}`',
        pos);
    return {fields: fields};
  }

  function spreadSchema(type: Type, pos: Position): JsxPropSchema {
    rejectUnsafe(type, pos);
    final fields = objectFields(type, true, 0);
    if (fields == null)
      fail('GTS-HXX-SPREAD-001',
        'HXX spread values must have a closed typed ' +
        'property structure; received `${typeName(type)}`',
        pos);
    return {fields: fields};
  }

  function objectFields(type: Type, allowTypeParameter: Bool,
      depth: Int): Null<Map<String, JsxPropField>> {
    if (depth > 64)
      return null;
    final resolved = resolveAliases(type);
    return switch resolved {
      case TAnonymous(anonymous):
        fieldsFromClassFields(anonymous.get().fields, [], []);
      case TInst(classRef, parameters):
        final classType = classRef.get();
        switch classType.kind {
          case KTypeParameter(constraints) if (allowTypeParameter):
            var found: Null<Map<String, JsxPropField>> = null;
            for (constraint in constraints) {
              final candidate = objectFields(constraint, true, depth + 1);
              if (candidate != null) {
                if (found != null)
                  return null;
                found = candidate;
              }
            }
            found;
          default:
            if (!classType.isExtern && !classType.isInterface) null; else
              fieldsFromClass(classType, parameters, 0);
        }
      default:
        null;
    }
  }

  /** Collects public property fields, including inherited interfaces. */
  function fieldsFromClass(classType: ClassType, parameters: Array<Type>,
      depth: Int): Map<String, JsxPropField> {
    if (depth > 64)
      fail('GTS-HXX-TAG-005',
        'Component property inheritance is deeper than the supported limit',
        classType.pos);
    final out: Map<String, JsxPropField> = [];
    if (classType.superClass != null) {
      final superType = classType.superClass.t.get();
      final superParameters = [
        for (parameter in classType.superClass.params)
          TypeTools.applyTypeParameters(parameter, classType.params, parameters)
      ];
      final superFields = fieldsFromClass(superType, superParameters,
        depth + 1);
      for (name => field in superFields)
        out.set(name, field);
    }
    for (relation in classType.interfaces) {
      final interfaceParameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, classType.params, parameters)
      ];
      final inherited = fieldsFromClass(relation.t.get(), interfaceParameters,
        depth + 1);
      for (name => field in inherited)
        out.set(name, field);
    }
    final own = fieldsFromClassFields(classType.fields.get(),
      classType.params, parameters);
    for (name => field in own)
      out.set(name, field);
    return out;
  }

  function fieldsFromClassFields(fields: Array<ClassField>,
      parameters: Array<TypeParameter>,
      concrete: Array<Type>): Map<String, JsxPropField> {
    final out: Map<String, JsxPropField> = [];
    for (field in fields) {
      if (!field.isPublic)
        continue;
      out.set(field.name, {
        name: field.name,
        type: parameters.length == 0 ? field.type : TypeTools.applyTypeParameters(field.type,
          parameters, concrete),
        optional: hasMeta(field.meta, 'optional'),
        pos: field.pos
      });
    }
    return out;
  }

  function requireAssignable(actual: Type, expected: Type,
      bindings: Map<String, Type>, allowAbsent: Bool, id: String,
      message: String, pos: Position): Void {
    rejectUnsafe(actual, pos);
    if (!isAssignable(actual, expected, bindings, allowAbsent, 0))
      fail(id, message, pos);
  }

  function isAssignable(actual: Type, expected: Type,
      bindings: Map<String, Type>, allowAbsent: Bool, depth: Int,
      allowExtraObjectFields = false): Bool {
    if (depth > 64)
      return false;
    final absentInner = undefinableInner(actual);
    if (absentInner != null)
      return allowAbsent
        && isAssignable(absentInner, expected, bindings, true, depth + 1,
          allowExtraObjectFields);

    final resolvedExpected = substitute(resolveAliases(expected), bindings);
    final nullableExpected = nullableInner(resolvedExpected);
    if (nullableExpected != null) {
      if (isNull(resolveAliases(actual)))
        return true;
      return isAssignable(actual, nullableExpected, bindings, allowAbsent,
        depth + 1, allowExtraObjectFields);
    }
    switch resolvedExpected {
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))):
        final key = typeParameterKey(parameterRef.get());
        final bound = bindings.get(key);
        if (bound != null)
          return isAssignable(actual, bound, bindings, false, depth + 1,
            allowExtraObjectFields);
        final constraints = switch parameterRef.get().kind {
          case KTypeParameter(found): found;
          default: [];
        };
        for (constraint in constraints)
          if (!isAssignable(actual, constraint, bindings, false, depth + 1,
            allowExtraObjectFields))
            return false;
        bindings.set(key, actual);
        return true;
      default:
    }

    final union = unionMembers(resolvedExpected);
    if (union != null) {
      for (member in union) {
        final branchBindings: Map<String, Type> = [
          for (key => value in bindings)
            key => value
        ];
        if (isAssignable(actual, member, branchBindings, false, depth + 1,
          allowExtraObjectFields)) {
          for (key => value in branchBindings)
            bindings.set(key, value);
          return true;
        }
      }
      return false;
    }

    if (isNodeContract(resolvedExpected))
      return isRenderable(actual, depth + 1);

    final resolvedActual = resolveAliases(actual);
    final eventCompatibility = reactEventCompatibility(resolvedActual,
      resolvedExpected, depth + 1);
    if (eventCompatibility != null)
      return eventCompatibility;
    switch [resolvedActual, resolvedExpected] {
      case [TFun(actualArgs, actualResult), TFun(expectedArgs, expectedResult)]:
        var requiredActual = 0;
        for (argument in actualArgs)
          if (!argument.opt)
            requiredActual++;
        var requiredExpected = 0;
        for (argument in expectedArgs)
          if (!argument.opt)
            requiredExpected++;
        if (requiredActual > requiredExpected
          || actualArgs.length > expectedArgs.length)
          return false;
        for (index in 0...actualArgs.length)
          if (!isAssignable(expectedArgs[index].t, actualArgs[index].t,
            bindings, false, depth + 1, true))
            return false;
        return isVoid(expectedResult)
          || isAssignable(actualResult, expectedResult, bindings, false,
            depth + 1, true);
      default:
    }
    final actualAnonymous = isAnonymous(resolvedActual);
    final expectedAnonymous = isAnonymous(resolvedExpected);
    if (!actualAnonymous && !expectedAnonymous
      && Context.unify(resolvedActual, resolvedExpected))
      return true;
    final actualObject = objectFields(resolvedActual, true, depth + 1);
    final expectedObject = objectFields(resolvedExpected, false, depth + 1);
    if (actualObject != null && expectedObject != null)
      return isObjectAssignable(actualObject, expectedObject, bindings,
        depth + 1, allowExtraObjectFields);
    return Context.unify(resolvedActual, resolvedExpected);
  }

  function isObjectAssignable(actual: Map<String, JsxPropField>,
      expected: Map<String, JsxPropField>, bindings: Map<String, Type>,
      depth: Int, allowExtraFields: Bool): Bool {
    if (depth > 64)
      return false;
    if (allowExtraFields) {
      for (name => expectedField in expected) {
        final actualField = actual.get(name);
        if (actualField == null) {
          if (!expectedField.optional)
            return false;
          continue;
        }
        if (actualField.optional && !expectedField.optional)
          return false;
        if (!isAssignable(actualField.type, expectedField.type, bindings,
          expectedField.optional, depth + 1, true))
          return false;
      }
      return true;
    }
    for (name => actualField in actual) {
      final expectedField = expected.get(name);
      if (expectedField == null)
        return false;
      if (actualField.optional && !expectedField.optional)
        return false;
      if (!isAssignable(actualField.type, expectedField.type, bindings,
        expectedField.optional, depth + 1))
        return false;
    }
    for (name => expectedField in expected)
      if (!expectedField.optional && !actual.exists(name))
        return false;
    return true;
  }

  static function isAnonymous(type: Type): Bool {
    // Callers pass an already followed type. Inspecting it directly avoids
    // changing an unresolved compiler type before the real unification step.
    return switch type {
      case TAnonymous(_): true;
      default: false;
    }
  }

  function isRenderable(type: Type, depth: Int): Bool {
    if (depth > 64 || isUnsafe(type))
      return false;
    final absentInner = undefinableInner(type);
    if (absentInner != null)
      return isRenderable(absentInner, depth + 1);
    final resolved = resolveAliases(type);
    final nullable = nullableInner(resolved);
    if (nullable != null)
      return isRenderable(nullable, depth + 1);
    final union = unionMembers(resolved);
    if (union != null) {
      for (member in union)
        if (!isRenderable(member, depth + 1))
          return false;
      return union.length > 0;
    }
    if (isNodeContract(resolved) || isScalarNode(resolved, depth + 1)
      || isNull(resolved))
      return true;
    final element = arrayElement(resolved);
    if (element != null)
      return isRenderable(element, depth + 1);
    final promise = promiseElement(resolved);
    return promise != null && isRenderable(promise, depth + 1);
  }

  function isComponentResult(type: Type): Bool {
    if (isRenderable(type, 0))
      return true;
    final inner = promiseElement(resolveAliases(type));
    return inner != null && isRenderable(inner, 1);
  }

  function loadIntrinsicProviders(): Void {
    final configured = Context.definedValue('genes.react.jsx_intrinsic_providers');
    final paths = configured == null
      || StringTools.trim(configured)
        .length == 0 ? [DEFAULT_INTRINSIC_PROVIDER] : [for (path in configured.split(',')) StringTools.trim(path)];
    for (path in paths) {
      if (path.length == 0)
        fail('GTS-HXX-SCHEMA-001', 'Intrinsic provider paths cannot be empty',
          Context.currentPos());
      loadIntrinsicProvider(path);
    }
  }

  function loadIntrinsicProvider(path: String): Void {
    final type = resolveAliases(Context.getType(path));
    final classType = switch type {
      case TInst(classRef, _): classRef.get();
      default:
        fail('GTS-HXX-SCHEMA-002',
          'Intrinsic provider `$path` must be a class ' +
          'with typed static fields',
          Context.currentPos());
    };
    final localPrefixes: Array<JsxPrefixContract> = [];
    final pending: Array<{name: String, type: Type, pos: Position}> = [];
    for (field in classType.statics.get()) {
      final intrinsic = metadataString(field.meta, 'genes.jsxIntrinsic');
      if (intrinsic != null)
        pending.push({
          name: intrinsic.value,
          type: field.type,
          pos: intrinsic.pos
        });
      final prefixMetadata = metadataString(field.meta,
        'genes.jsxAttributePrefix');
      if (prefixMetadata != null) {
        final prefix = prefixMetadata.value;
        if (prefix.length == 0)
          fail('GTS-HXX-SCHEMA-003',
            '$path declares an empty attribute prefix', prefixMetadata.pos);
        for (existing in localPrefixes)
          if (existing.prefix == prefix)
            fail('GTS-HXX-SCHEMA-007',
              '$path declares attribute prefix `$prefix` more than once',
              prefixMetadata.pos);
        final contract = {
          prefix: prefix,
          type: field.type,
          pos: prefixMetadata.pos
        };
        localPrefixes.push(contract);
      }
    }
    for (entry in pending) {
      if (intrinsics.exists(entry.name))
        fail('GTS-HXX-SCHEMA-004',
          'Intrinsic `${entry.name}` is declared by ' +
          'more than one provider',
          entry.pos);
      intrinsics.set(entry.name, {
        name: entry.name,
        schema: propSchema(entry.type, entry.pos,
          'intrinsic `${entry.name}` properties'),
        prefixes: localPrefixes,
        pos: entry.pos
      });
    }
  }

  static function childExpression(child: JsxChildIntent): TypedExpr {
    return switch child {
      case ChildIntent(expression, _): expression;
    }
  }

  static function matchingPrefix(name: String,
      accepted: Array<JsxPrefixContract>): Null<JsxPrefixContract> {
    for (contract in accepted)
      if (StringTools.startsWith(name, contract.prefix))
        return contract;
    return null;
  }

  static function componentName(expression: TypedExpr): String {
    return switch JsxPlan.unwrap(expression).expr {
      case TLocal(variable): variable.name;
      case TField(_, access): switch access {
          case FStatic(_, field) | FInstance(_, _, field) | FAnon(field) |
            FClosure(_, field): field.get().name;
          case FDynamic(name): name;
          case FEnum(_, field): field.name;
        }
      default: 'expression';
    }
  }

  static function substitute(type: Type, bindings: Map<String, Type>,
      depth = 0): Type {
    if (depth > 64)
      return type;
    return switch type {
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))
          && bindings.exists(typeParameterKey(parameterRef.get()))):
        bindings.get(typeParameterKey(parameterRef.get()));
      default:
        TypeTools.map(type, child -> substitute(child, bindings, depth + 1));
    }
  }

  static function resolveAliases(type: Type): Type {
    return switch type {
      case TType(_, _) | TLazy(_): resolveAliases(Context.follow(type));
      case TMono(reference) if (reference.get() != null):
        resolveAliases(reference.get());
      default: type;
    }
  }

  static function unionMembers(type: Type): Null<Array<Type>> {
    return switch resolveAliases(type) {
      case TInst(classRef, parameters)
        if (hasMeta(classRef.get().meta, 'genes.jsxUnion')):
        parameters;
      case TAbstract(abstractRef, parameters)
        if (abstractRef.get().pack.join('.') == 'haxe.extern'
          && abstractRef.get().name == 'EitherType'):
        parameters;
      default: null;
    }
  }

  static function isNodeContract(type: Type): Bool {
    final resolved = resolveAliases(type);
    final nullable = nullableInner(resolved);
    if (nullable != null)
      return isNodeContract(nullable);
    return switch resolved {
      case TInst(classRef, _):
        hasMeta(classRef.get().meta, 'genes.jsxNode');
      case TAbstract(abstractRef, _):
        hasMeta(abstractRef.get().meta, 'genes.jsxNode');
      default: false;
    }
  }

  static function isScalarNode(type: Type, depth: Int): Bool {
    if (depth > 64)
      return false;
    return switch resolveAliases(type) {
      case TInst(classRef, _): classRef.get()
          .pack.length == 0 && classRef.get().name == 'String';
      case TAbstract(abstractRef, parameters):
        final abstractType = abstractRef.get();
        if (abstractType.pack.length == 0
          && ['Int', 'Float', 'Bool'].indexOf(abstractType.name) != -1)
          true; else
          isScalarNode(TypeTools.applyTypeParameters(abstractType.type,
            abstractType.params, parameters),
          depth
          + 1);
      default: false;
    }
  }

  static function isKey(type: Type, depth = 0): Bool {
    if (depth > 64 || isUnsafe(type))
      return false;
    final absent = undefinableInner(type);
    if (absent != null)
      return isKey(absent, depth + 1);
    final resolved = resolveAliases(type);
    final nullable = nullableInner(resolved);
    if (nullable != null)
      return isKey(nullable, depth + 1);
    final union = unionMembers(resolved);
    if (union != null) {
      for (member in union)
        if (!isKey(member, depth + 1))
          return false;
      return union.length > 0;
    }
    if (isNull(resolved))
      return true;
    return switch resolved {
      case TInst(classRef, _): classRef.get()
          .pack.length == 0 && classRef.get().name == 'String';
      case TAbstract(abstractRef, parameters):
        final abstractType = abstractRef.get();
        if (abstractType.pack.length == 0
          && ['Int', 'Float'].indexOf(abstractType.name) != -1) true; else
          isKey(TypeTools.applyTypeParameters(abstractType.type,
            abstractType.params, parameters),
          depth
          + 1);
      default: false;
    }
  }

  static function isNull(type: Type): Bool {
    return switch resolveAliases(type) {
      case TMono(reference): reference.get() == null;
      case TDynamic(inner): inner == null;
      case TAbstract(abstractRef, _): abstractRef.get()
          .pack.length == 0 && abstractRef.get().name == 'Null';
      default: false;
    }
  }

  static function isVoid(type: Type): Bool {
    return switch resolveAliases(type) {
      case TAbstract(abstractRef, _): abstractRef.get()
          .pack.length == 0 && abstractRef.get().name == 'Void';
      default: false;
    }
  }

  /**
   * Keeps a React event's target type instead of treating it as decoration.
   *
   * Haxe may consider two instances of a phantom generic extern compatible
   * when the type parameter has no runtime field. React still uses that
   * parameter in generated TypeScript (`MouseEvent<HTMLButtonElement>`), so
   * HXX compares it explicitly before Haxe's general unifier runs.
   */
  static function reactEventCompatibility(left: Type, right: Type,
      depth: Int): Null<Bool> {
    if (depth > 64)
      return false;
    return switch [resolveAliases(left), resolveAliases(right)] {
      case [TInst(leftRef, leftParameters), TInst(rightRef, rightParameters)]:
        final leftType = leftRef.get();
        final rightType = rightRef.get();
        final family = ['ChangeEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'SyntheticEvent'];
        if (leftType.pack.join('.') != 'genes.react'
          || rightType.pack.join('.') != 'genes.react'
          || family.indexOf(leftType.name) == -1
          || family.indexOf(rightType.name) == -1) null; else
          if (leftParameters.length != rightParameters.length) false; else {
          var compatible = true;
          for (index in 0...leftParameters.length)
            if (!sameInvariantType(leftParameters[index],
              rightParameters[index], depth + 1)) {
              compatible = false;
              break;
            }
          if (!compatible)
            false;
          else
            leftType.name == rightType.name ? true : null;
        }
      default: null;
    }
  }

  static function sameInvariantType(left: Type, right: Type, depth: Int): Bool {
    if (depth > 64)
      return false;
    return switch [resolveAliases(left), resolveAliases(right)] {
      case [TInst(leftRef, leftParameters), TInst(rightRef, rightParameters)]: leftRef.get()
          .module == rightRef.get()
          .module && leftRef.get()
          .name == rightRef.get()
          .name && sameTypeParameters(leftParameters, rightParameters, depth + 1);
      case [TAbstract(leftRef,
        leftParameters), TAbstract(rightRef, rightParameters)]: leftRef.get()
          .module == rightRef.get()
          .module && leftRef.get()
          .name == rightRef.get()
          .name && sameTypeParameters(leftParameters, rightParameters, depth + 1);
      case [TEnum(leftRef, leftParameters), TEnum(rightRef, rightParameters)]: leftRef.get()
          .module == rightRef.get()
          .module && leftRef.get()
          .name == rightRef.get()
          .name && sameTypeParameters(leftParameters, rightParameters, depth + 1);
      default: Context.unify(left, right) && Context.unify(right, left);
    }
  }

  static function sameTypeParameters(left: Array<Type>, right: Array<Type>,
      depth: Int): Bool {
    if (left.length != right.length)
      return false;
    for (index in 0...left.length)
      if (!sameInvariantType(left[index], right[index], depth + 1))
        return false;
    return true;
  }

  static function arrayElement(type: Type): Null<Type> {
    final resolved = resolveAliases(type);
    final nullable = nullableInner(resolved);
    if (nullable != null)
      return arrayElement(nullable);
    return switch resolved {
      case TInst(classRef, [element])
        if (classRef.get().pack.length == 0 && classRef.get().name == 'Array'):
        element;
      default: null;
    }
  }

  static function promiseElement(type: Type): Null<Type> {
    final resolved = resolveAliases(type);
    final nullable = nullableInner(resolved);
    if (nullable != null)
      return promiseElement(nullable);
    return switch resolved {
      case TInst(classRef, [element])
        if (classRef.get().pack.join('.') == 'js.lib'
          && classRef.get().name == 'Promise'):
        element;
      default: null;
    }
  }

  static function undefinableInner(type: Type): Null<Type> {
    return switch resolveAliases(type) {
      case TAbstract(abstractRef, [inner])
        if (abstractRef.get().pack.join('.') == 'genes.ts'
          && abstractRef.get().name == 'Undefinable'):
        inner;
      default: null;
    }
  }

  static function nullableInner(type: Type): Null<Type> {
    return switch resolveAliases(type) {
      case TAbstract(abstractRef, [inner])
        if (abstractRef.get().pack.length == 0
          && abstractRef.get().name == 'Null'):
        inner;
      case TType(typeRef, [inner])
        if (typeRef.get().pack.length == 0 && typeRef.get().name == 'Null'):
        inner;
      default: null;
    }
  }

  static function rejectUnsafe(type: Type, pos: Position): Void {
    if (isUnsafe(type))
      fail('GTS-HXX-TYPE-001',
        'HXX values must have a resolved concrete Haxe ' +
        'type; received `${typeName(type)}`',
        pos);
  }

  /** Rejects weak types even when they are nested inside a safe container. */
  static function isUnsafe(type: Type, depth = 0): Bool {
    if (depth > 64)
      return true;
    final resolved = resolveAliases(type);
    return switch resolved {
      case TDynamic(_): true;
      case TMono(reference): reference.get() == null;
      case TAbstract(abstractRef, _): abstractRef.get()
          .pack.join('.') == 'genes.ts' && abstractRef.get()
          .name == 'Unknown' ? true : hasUnsafeChild(resolved, depth + 1);
      default: hasUnsafeChild(resolved, depth + 1);
    }
  }

  static function hasUnsafeChild(type: Type, depth: Int): Bool {
    var unsafe = false;
    TypeTools.iter(type, child -> {
      if (!unsafe && isUnsafe(child, depth))
        unsafe = true;
    });
    return unsafe;
  }

  static function typeParameterKey(type: ClassType): String {
    final info = Context.getPosInfos(type.pos);
    return '${type.module}:${type.name}:${info.file}:${info.min}';
  }

  static function typeName(type: Type): String {
    return TypeTools.toString(type);
  }

  /**
   * Reads one string-literal annotation without discarding its source span.
   *
   * Metadata changes the HXX schema, so malformed or conflicting declarations
   * must point at the annotation the author needs to edit rather than the
   * following field declaration.
   */
  static function metadataString(meta: MetaAccess,
      name: String): Null<JsxStringMetadata> {
    for (entry in metadata(meta, name)) {
      return switch entry.params {
        case [{expr: EConst(CString(value, _))}]: {
            value: value,
            pos: entry.pos
          };
        default:
          fail('GTS-HXX-SCHEMA-005',
            '@:$name expects exactly one string ' + 'literal', entry.pos);
      }
    }
    return null;
  }

  static function hasMeta(meta: MetaAccess, name: String): Bool {
    return metadata(meta, name).length > 0;
  }

  static function metadata(meta: MetaAccess,
      name: String): Array<MetadataEntry> {
    if (meta == null)
      return [];
    final colon = StringTools.startsWith(name, ':') ? name : ':$name';
    final direct = StringTools.startsWith(name, ':') ? name.substr(1) : name;
    return meta.extract(colon).concat(meta.extract(direct));
  }

  static function fail<T>(id: String, message: String, pos: Position): T {
    return CompilerDiagnostic.fail('[$id] $message.', pos);
  }
}
