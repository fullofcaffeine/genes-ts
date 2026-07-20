package genes;

import genes.JsxPlan.JsxChildIntent;
import genes.JsxPlan.JsxIntent;
import genes.JsxPlan.JsxPropIntent;
import genes.JsxPlan.JsxTagIntent;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.Type.DefType;
import haxe.macro.Type.Ref;
import haxe.macro.TypeTools;

private typedef JsxPropField = {
  var name: String;
  var type: Type;
  var presentType: Type;
  var optional: Bool;
  var allowsUndefined: Bool;
  var pos: Position;
}

private typedef JsxPropSchema = {
  var fields: Map<String, JsxPropField>;
  var optionalValuesAllowUndefined: Bool;
}

private typedef JsxPrefixContract = {
  var prefix: String;
  var type: Type;
  var pos: Position;
  var allowsUndefined: Bool;
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
  var emissionPropsType: Null<Type>;
}

private typedef JsxStringMetadata = {
  var value: String;
  var pos: Position;
}

private typedef JsxUnsafeVisit = {
  var owner: Ref<DefType>;
  var arguments: Array<String>;
}

private typedef JsxFunctionArgument = {
  var name: String;
  var opt: Bool;
  var t: Type;
}

/**
 * Records the small set of HXX facts needed after type validation finishes.
 *
 * Why: TypeScript's low-level `createElement` declarations check only the
 * property-object argument when deciding whether a required `children` field
 * is present. They do not use later child arguments for that check, even
 * though React uses those arguments as the component's children at runtime.
 *
 * What: `componentPropsType` retains an inferred generic component contract,
 * while `nestedChildrenSupplyRequiredProperty` says that authored nested HXX
 * content is the value of a required `children` property.
 *
 * How: `JsxPlan` stores these immutable facts beside the tag's typed
 * expression. The TypeScript createElement printer can then choose legal
 * syntax without rediscovering the component schema or weakening its types.
 */
typedef JsxValidationResult = {
  final componentPropsType: Null<Type>;
  final nestedChildrenSupplyRequiredProperty: Bool;
}

/**
 * Describes whether HXX knows that a `children` property exists at runtime.
 *
 * Why: an optional field in a spread may be absent. Treating it as definitely
 * present rejects valid markup such as `<Card {...maybeChildren}>nested</Card>`
 * and can also let the same uncertain field satisfy a required child.
 *
 * What: a named property or required spread field is `Definite`; an optional
 * spread field is only `Possible`; `Absent` means no property source has
 * mentioned `children`.
 *
 * How: only `Definite` conflicts with nested HXX children. `Possible` follows
 * the nested-child path, so authored nested content supplies the value and an
 * omitted required child still reports the ordinary missing-child diagnostic.
 */
private enum JsxChildrenPresence {
  Absent;
  Possible;
  Definite;
}

/**
 * Canonical browser identity shared by Haxe's DOM externs and React facades.
 *
 * React's small event-target facades and Haxe's full `js.html` externs emit the
 * same TypeScript browser names. Keeping that equivalence typed and local to
 * React event comparison lets migration code retain the complete DOM API
 * without making unrelated Haxe classes structurally interchangeable.
 */
private enum abstract JsxBrowserElementIdentity(String) {
  var HtmlElement = 'html-element';
  var AnchorElement = 'anchor-element';
  var InputElement = 'input-element';
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

  public function validate(intent: JsxIntent): JsxValidationResult {
    return switch intent {
      case ElementIntent(tag, props, children, _):
        switch tag {
          case IntrinsicTag(name, expression):
            final contract = intrinsics.get(name);
            if (contract == null)
              fail('GTS-HXX-TAG-001',
                'Unknown intrinsic tag `<$name>`. ' +
                'Add it to a typed intrinsic provider or correct the tag name',
                expression.pos);
            final nestedChildrenSupplyRequiredProperty = validateProps('<$name>',
              contract.schema, contract.prefixes, props, children,
              [], expression.pos);
            {
              componentPropsType: null,
              nestedChildrenSupplyRequiredProperty: nestedChildrenSupplyRequiredProperty
            };
          case ComponentTag(expression):
            final contract = componentContract(expression);
            final nestedChildrenSupplyRequiredProperty = validateProps('component `${componentName(expression)}`',
              contract.schema, [],
              props, children, contract.bindings, expression.pos);
            {
              componentPropsType: specializedComponentPropsType(contract),
              nestedChildrenSupplyRequiredProperty: nestedChildrenSupplyRequiredProperty
            };
          case DynamicIntrinsicTag(_):
            // The low-level internal marker retains runtime-string support for
            // compiler migrations. HXX source itself always has a static tag.
            validateDynamicMarker(props, children);
            {
              componentPropsType: null,
              nestedChildrenSupplyRequiredProperty: false
            };
        }
      case FragmentIntent(children, _):
        validateRenderableChildren('fragment', children);
        {
          componentPropsType: null,
          nestedChildrenSupplyRequiredProperty: false
        };
    };
  }

  function validateProps(label: String, schema: JsxPropSchema,
      acceptedPrefixes: Array<JsxPrefixContract>, props: Array<JsxPropIntent>,
      children: Array<JsxChildIntent>, bindings: Map<String, Type>,
      tagPos: Position): Bool {
    final provided: Map<String, Bool> = [];
    var childrenPresence = Absent;

    for (prop in props) {
      switch prop {
        case NamedProp(name, value, _):
          if (provided.exists(name))
            fail('GTS-HXX-PROP-003', '$label provides `$name` more than once',
              value.pos);
          provided.set(name, true);
          if (name == 'children')
            childrenPresence = Definite;
          final field = schema.fields.get(name);
          if (field != null) {
            requireAssignable(value.t, field.type, bindings,
              'GTS-HXX-PROP-002',
              '$label property `$name` expects `${typeName(field.type)}` but ' +
              'received `${typeName(value.t)}`',
              value.pos,
              isNullLiteral(value), field.optional && (field.allowsUndefined
                || schema.optionalValuesAllowUndefined));
          } else if (name == 'key') {
            if (!isNullLiteral(value) && !isKey(value.t))
              fail('GTS-HXX-PROP-002',
                '$label property `key` expects ' +
                '`String | Int` but received `${typeName(value.t)}`',
                value.pos);
          } else {
            final prefix = matchingPrefix(name, acceptedPrefixes);
            if (prefix == null)
              fail('GTS-HXX-PROP-001',
                '$label does not declare a `$name` ' + 'property', value.pos);
            requireAssignable(value.t, prefix.type, bindings,
              'GTS-HXX-PROP-002',
              '$label prefixed property `$name` expects ' +
              '`${typeName(prefix.type)}` but received ' +
              '`${typeName(value.t)}`',
              value.pos, isNullLiteral(value), prefix.allowsUndefined);
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
              childrenPresence = combineChildrenPresence(childrenPresence,
                actual.optional ? Possible : Definite);
            final expected = schema.fields.get(name);
            if (expected != null) {
              // An optional spread field cannot satisfy a required property,
              // regardless of its payload type. Leave it marked as missing so
              // the later required-property check reports the useful problem.
              // Optional-to-optional comparisons retain the complete typed
              // `Null<T>` contract unless the spread field explicitly uses
              // `@:ts.optional`. That metadata converts Haxe's synthetic null
              // write to host undefined, so its present value is the precise
              // comparison type; an authored inner Null<T> remains intact.
              if (!actual.optional || expected.optional) {
                final actualType = actual.optional
                  && actual.allowsUndefined ? actual.presentType : actual.type;
                requireAssignable(actualType, expected.type, bindings,
                  'GTS-HXX-SPREAD-002',
                  '$label spread property `$name` expects ' +
                  '`${typeName(expected.type)}` but received ' +
                  '`${typeName(actualType)}`',
                  expression.pos,
                  false, expected.optional && (expected.allowsUndefined
                    || schema.optionalValuesAllowUndefined));
              }
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
                'GTS-HXX-SPREAD-002',
                '$label spread property `$name` expects ' +
                '`${typeName(prefix.type)}` but received ' +
                '`${typeName(actual.type)}`',
                expression.pos, false, prefix.allowsUndefined);
            }
          }
      }
    }

    if (childrenPresence == Definite && children.length > 0)
      fail('GTS-HXX-CHILD-004',
        '$label cannot combine a `children` property ' +
        'with nested HXX children',
        childExpression(children[0]).pos);

    final childField = schema.fields.get('children');
    if (childrenPresence != Definite)
      validateNestedChildren(label, childField, children, bindings, tagPos);

    for (name => field in schema.fields) {
      if (field.optional || name == 'children')
        continue;
      if (!provided.exists(name) || !provided.get(name))
        fail('GTS-HXX-PROP-004',
          '$label is missing required property `$name`', tagPos);
    }

    return childField != null
      && !childField.optional
      && childrenPresence != Definite
      && children.length > 0;
  }

  static function combineChildrenPresence(current: JsxChildrenPresence,
      incoming: JsxChildrenPresence): JsxChildrenPresence {
    return switch [current, incoming] {
      case [Definite, _] | [_, Definite]: Definite;
      case [Possible, _] | [_, Possible]: Possible;
      case _: Absent;
    };
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
      // JSX gives an array-shaped `children` property either one authored
      // array expression or an array assembled from several nested children.
      // One scalar child stays scalar at runtime, so accepting it here would
      // promise the component an array that React never creates.
      if (children.length == 1) {
        final expression = childExpression(children[0]);
        rejectUnsafeForExpected(expression.t, expected, expression.pos,
          isNullLiteral(expression));
        final directBindings: Map<String, Type> = [
          for (key => value in bindings)
            key => value
        ];
        if (!isAssignable(expression.t, expected, directBindings, 0, false,
          isNullLiteral(expression)))
          fail('GTS-HXX-CHILD-003',
            '$label requires an array-valued child compatible with '
            + '`${typeName(expected)}` when only one child is nested. '
            + 'Supply the array expression itself, or provide two or more '
            + 'separate children compatible with `${typeName(elementType)}`',
            expression.pos);
        for (key => value in directBindings)
          bindings.set(key, value);
        return;
      }
      for (child in children) {
        final expression = childExpression(child);
        requireAssignable(expression.t, elementType, bindings,
          'GTS-HXX-CHILD-003',
          '$label child expects ' +
          '`${typeName(elementType)}` but received ' +
          '`${typeName(expression.t)}`',
          expression.pos, isNullLiteral(expression));
      }
      return;
    }
    if (children.length != 1)
      fail('GTS-HXX-CHILD-003',
        '$label accepts one child of type ' +
        '`${typeName(expected)}`, not ${children.length} children',
        childExpression(children[1]).pos);
    final expression = childExpression(children[0]);
    requireAssignable(expression.t, expected, bindings, 'GTS-HXX-CHILD-003',
      '$label child expects `${typeName(expected)}` ' +
      'but received `${typeName(expression.t)}`',
      expression.pos, isNullLiteral(expression));
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
      if (!isNullLiteral(expression) && !isRenderable(expression.t, 0))
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
          fields: new Map<String, JsxPropField>(),
          optionalValuesAllowUndefined: false
        } : propSchema(arguments[0].t, expression.pos,
          'component `${componentName(expression)}` properties');
        {
          schema: schema,
          bindings: new Map<String, Type>(),
          // React's normal `ComponentPropsWithoutRef<typeof Tag>` path is
          // concise and already correct for concrete functions and aliases.
          // Only a direct open generic needs HXX's inferred Haxe type carried
          // into `createElement<T>`; otherwise React would widen it to unknown.
          emissionPropsType: arguments.length == 0
          || !hasOpenComponentType(arguments[0].t) ? null : arguments[0].t
        };
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
      bindings: new Map<String, Type>(),
      // Metadata-backed wrappers already carry their property type in their
      // emitted React component type. Keeping the utility-type path also means
      // a checker-only `@:genes.semanticOnly` schema is never named in output.
      emissionPropsType: null
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

  function propSchema(type: Type, pos: Position, label: String,
      optionalValuesAllowUndefined = false): JsxPropSchema {
    final fields = objectFields(type, false, 0);
    if (fields == null)
      fail('GTS-HXX-TAG-005',
        '$label must be a closed anonymous structure or ' +
        'an extern/interface property contract; received `${typeName(type)}`',
        pos);
    for (name => field in fields)
      if (isUnsafeSchema(field.type))
        fail('GTS-HXX-SCHEMA-008',
          '$label declares `$name` with weak type `${typeName(field.type)}`. ' +
          'HXX property contracts must use resolved concrete Haxe types',
          field.pos);
    // Haxe represents `@:optional var href:String` as `Null<String>` in the
    // typed tree. React's declaration means something narrower:
    // `href?: string | undefined` permits omission or a supplied undefined,
    // but not a supplied null. Provider-wide policy or a field's
    // `@:ts.optional` metadata opts into that host contract, so validation
    // removes only Haxe's synthetic outer null. A provider that intentionally
    // accepts both sentinels can write `Undefinable<Null<T>>`; `presentType`
    // preserves that inner Null<T>.
    for (field in fields)
      if (field.optional
        && (optionalValuesAllowUndefined || field.allowsUndefined))
        field.type = field.presentType;
    return {
      fields: fields,
      optionalValuesAllowUndefined: optionalValuesAllowUndefined
    };
  }

  function spreadSchema(type: Type, pos: Position): JsxPropSchema {
    rejectUnsafe(type, pos);
    final fields = objectFields(type, true, 0);
    if (fields == null)
      fail('GTS-HXX-SPREAD-001',
        'HXX spread values must have a closed typed ' +
        'property structure; received `${typeName(type)}`',
        pos);
    return {fields: fields, optionalValuesAllowUndefined: false};
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
      final nullish = NullishContract.forField(field);
      final declaredType = parameters.length == 0 ? field.type : TypeTools.applyTypeParameters(field.type,
        parameters, concrete);
      final presentType = parameters.length == 0 ? nullish.valueType : TypeTools.applyTypeParameters(nullish.valueType,
        parameters, concrete);
      out.set(field.name, {
        name: field.name,
        type: declaredType,
        presentType: presentType,
        optional: hasMeta(field.meta, 'optional'),
        allowsUndefined: hasMeta(field.meta, 'ts.optional')
        || nullish.explicitUndefined,
        pos: field.pos
      });
    }
    return out;
  }

  function requireAssignable(actual: Type, expected: Type,
      bindings: Map<String, Type>, id: String, message: String, pos: Position,
      literalNull = false, allowUndefined = false): Void {
    final checkedActual = allowUndefined
      && NullishContract.forType(actual)
        .explicitUndefined ? stripExplicitUndefined(actual) : actual;
    rejectUnsafeForExpected(checkedActual, expected, pos, literalNull);
    if (!isAssignable(checkedActual, expected, bindings, 0, false, literalNull))
      fail(id, message, pos);
  }

  function isAssignable(actual: Type, expected: Type,
      bindings: Map<String, Type>, depth: Int, allowExtraObjectFields = false,
      literalNull = false): Bool {
    if (depth > 64)
      return false;
    final resolvedExpected = substitute(resolveAliases(expected), bindings);
    final undefinedExpected = undefinableInner(resolvedExpected);
    if (undefinedExpected != null) {
      final presentActual = NullishContract.forType(actual)
        .explicitUndefined ? stripExplicitUndefined(actual) : actual;
      return isAssignable(presentActual, undefinedExpected, bindings,
        depth + 1, allowExtraObjectFields, literalNull);
    }
    final nullableExpected = nullableInner(resolvedExpected);
    if (nullableExpected != null) {
      if (literalNull)
        return true;
      final resolvedActual = resolveAliases(actual);
      final nullableActual = nullableInner(resolvedActual);
      return isAssignable(nullableActual == null ? actual : nullableActual,
        nullableExpected, bindings, depth + 1, allowExtraObjectFields);
    }
    switch resolvedExpected {
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))):
        final key = typeParameterKey(parameterRef.get());
        final bound = bindings.get(key);
        if (bound != null)
          return isAssignable(actual, bound, bindings, depth + 1,
            allowExtraObjectFields);
        final constraints = switch parameterRef.get().kind {
          case KTypeParameter(found): found;
          default: [];
        };
        for (constraint in constraints)
          if (!isAssignable(actual, constraint, bindings, depth + 1,
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
        if (isAssignable(actual, member, branchBindings, depth + 1,
          allowExtraObjectFields, literalNull)) {
          for (key => value in branchBindings)
            bindings.set(key, value);
          return true;
        }
      }
      return false;
    }

    if (isNodeContract(resolvedExpected))
      return literalNull || isRenderable(actual, depth + 1);

    final resolvedActual = resolveAliases(actual);
    if (undefinableInner(resolvedActual) != null)
      return false;
    // Haxe's JavaScript target can unify `Null<T>` with `T`, but an explicit
    // HXX property is also checked by TypeScript where `T | null` cannot fill
    // a non-null `T`. Omission and `undefined` use the separate
    // `Undefinable<T>` path above; only an expected nullable/union contract may
    // accept a value that can actually be null.
    if (nullableInner(resolvedActual) != null || literalNull)
      return false;
    final nativeGlobalCompatibility = nativeGlobalAssignability(resolvedActual,
      resolvedExpected, depth
      + 1);
    if (nativeGlobalCompatibility != null)
      return nativeGlobalCompatibility;
    final eventCompatibility = reactEventAssignability(resolvedActual,
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
        if (requiredActual > requiredExpected)
          return false;
        final sharedArguments = actualArgs.length < expectedArgs.length ? actualArgs.length : expectedArgs.length;
        for (index in 0...sharedArguments)
          if (!isAssignable(expectedArgs[index].t, actualArgs[index].t,
            bindings, depth + 1, true))
            return false;
        for (index in sharedArguments...actualArgs.length)
          if (!actualArgs[index].opt)
            return false;
        return isVoid(expectedResult)
          || isAssignable(actualResult, expectedResult, bindings, depth + 1,
            true);
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
          depth + 1, true))
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
        depth + 1))
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
    if (isNodeContract(resolved) || isScalarNode(resolved, depth + 1))
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
    final optionalValuesAllowUndefined = hasMeta(classType.meta,
      'genes.jsxOptionalValuesAllowUndefined');
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
              prefixMetadata.pos)
          else if (StringTools.startsWith(prefix, existing.prefix)
            || StringTools.startsWith(existing.prefix, prefix))
            fail('GTS-HXX-SCHEMA-009',
              '$path declares overlapping attribute prefixes ' +
              '`${existing.prefix}` and `$prefix`. One property could match ' +
              'both contracts, so use non-overlapping prefixes',
              prefixMetadata.pos);
        if (isUnsafe(field.type))
          fail('GTS-HXX-SCHEMA-008',
            '$path declares attribute prefix `$prefix` with weak type ' +
            '`${typeName(field.type)}`. Prefix contracts must use a resolved ' +
            'concrete Haxe type',
            prefixMetadata.pos);
        final contract = {
          prefix: prefix,
          type: field.type,
          pos: prefixMetadata.pos,
          allowsUndefined: optionalValuesAllowUndefined
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
          'intrinsic `${entry.name}` properties', optionalValuesAllowUndefined),
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

  /**
   * Reports whether a component property type still names an unbound generic.
   *
   * A direct generic component can be specialized from its supplied HXX
   * properties. If no property determines one of its type parameters, however,
   * that parameter has no legal name in the surrounding generated function.
   * The emitter must then use React's ordinary type inference instead of
   * printing a dangling Haxe type parameter.
   */
  static function hasUnboundTypeParameter(type: Type,
      bindings: Map<String, Type>, depth = 0): Bool {
    if (depth > 64)
      return true;
    return switch type {
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))):
        !bindings.exists(typeParameterKey(parameterRef.get()));
      default:
        var found = false;
        TypeTools.iter(type, child -> {
          if (!found && hasUnboundTypeParameter(child, bindings, depth + 1))
            found = true;
        });
        found;
    }
  }

  /**
   * Reports whether a direct function component still needs generic inference.
   *
   * Why: concrete component functions should keep React's short, established
   * `ComponentPropsWithoutRef<typeof Tag>` output. A direct generic function is
   * different: React cannot recover the Haxe type chosen from its HXX values,
   * so the compiler must carry that one specialization into `createElement`.
   *
   * What/How: compiler-owned type parameters and unresolved monomorphs count as
   * open. The walk is read-only and bounded; an unexpected recursive compiler
   * type conservatively keeps React's ordinary utility-type path.
   */
  static function hasOpenComponentType(type: Type, depth = 0): Bool {
    if (depth > 64)
      return false;
    return switch type {
      case TMono(reference): final resolved = reference.get(); resolved == null || hasOpenComponentType(resolved,
          depth
          + 1);
      case TInst(parameterRef, _)
        if (parameterRef.get().kind.match(KTypeParameter(_))):
        true;
      default:
        var found = false;
        TypeTools.iter(type, child -> {
          if (!found && hasOpenComponentType(child, depth + 1))
            found = true;
        });
        found;
    }
  }

  /**
   * Returns a safe, fully inferred property type for TypeScript emission.
   *
   * Haxe may leave a generic parameter open when no supplied property chooses
   * it. A literal `null` can also appear as Haxe's weak internal null type even
   * though the authored value itself is precise. Neither case is a type the
   * emitter may print. React's normal inference remains the safe fallback, so
   * this method returns no specialization until every printed part is concrete.
   */
  static function specializedComponentPropsType(contract: JsxComponentContract): Null<Type> {
    final original = contract.emissionPropsType;
    if (original == null
      || hasUnboundTypeParameter(original, contract.bindings))
      return null;
    final specialized = substitute(original, contract.bindings);
    return isUnsafe(specialized) ? null : specialized;
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

  /** Returns whether this exact HXX value is the authored `null` constant. */
  static function isNullLiteral(expression: TypedExpr): Bool {
    return switch JsxPlan.unwrap(expression).expr {
      case TConst(TNull): true;
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
   * Recognizes two explicit extern views of one native global host type.
   *
   * Why: ecosystem libraries sometimes provide a focused Haxe extern for a
   * browser global whose standard-library facade is outdated or deliberately
   * broader. Haxe gives those two declarations different nominal identities,
   * even when both explicitly bind to the same runtime constructor. A callback
   * using the focused facade would otherwise fail HXX before its valid
   * TypeScript projection exists.
   *
   * What: two extern classes with the same literal `@:native` identity and no
   * package-owning `@:jsRequire` are treated as the same global host type.
   * Generic arguments remain invariant. A missing or different global identity
   * is incompatible unless a real Haxe class/interface edge relates the two;
   * structural similarity alone is never treated as host identity.
   *
   * How: this reads typed declaration metadata only; it never compares emitted
   * TypeScript strings or structurally unifies empty externs. The extern author
   * remains responsible for accurately describing that host object, just as
   * for every `@:native` boundary.
   */
  static function nativeGlobalAssignability(actual: Type, expected: Type,
      depth: Int): Null<Bool> {
    if (depth > 64)
      return false;
    return switch [resolveAliases(actual), resolveAliases(expected)] {
      case [TInst(actualRef,
        actualParameters), TInst(expectedRef, expectedParameters)]:
        final actualIdentity = nativeGlobalIdentity(actualRef.get());
        final expectedIdentity = nativeGlobalIdentity(expectedRef.get());
        if (actualIdentity == null && expectedIdentity == null) null; else
          if (actualIdentity != null
          && actualIdentity == expectedIdentity)
            sameTypeParameters(actualParameters, expectedParameters,
            depth
            + 1); else if (nominalClassRelated(actualRef, actualParameters,
          expectedRef, expectedParameters, depth + 1)) null; else false;
      default: null;
    }
  }

  /** Preserves real Haxe inheritance when native global names differ. */
  static function nominalClassRelated(leftRef: Ref<ClassType>,
      leftParameters: Array<Type>, rightRef: Ref<ClassType>,
      rightParameters: Array<Type>, depth: Int): Bool {
    return nominalClassAssignable(leftRef, leftParameters, rightRef,
      rightParameters, depth + 1)
      || nominalClassAssignable(rightRef, rightParameters, leftRef,
        leftParameters, depth + 1);
  }

  /** Follows declared class/interface edges without structural unification. */
  static function nominalClassAssignable(actualRef: Ref<ClassType>,
      actualParameters: Array<Type>, expectedRef: Ref<ClassType>,
      expectedParameters: Array<Type>, depth: Int): Bool {
    if (depth > 64)
      return false;
    final actualType = actualRef.get();
    if (sameClassIdentity(actualType, expectedRef.get()))
      return sameTypeParameters(actualParameters, expectedParameters,
        depth + 1);
    if (actualType.superClass != null) {
      final relation = actualType.superClass;
      final parentParameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actualType.params,
            actualParameters)
      ];
      if (nominalClassAssignable(relation.t, parentParameters, expectedRef,
        expectedParameters, depth + 1))
        return true;
    }
    for (relation in actualType.interfaces) {
      final interfaceParameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actualType.params,
            actualParameters)
      ];
      if (nominalClassAssignable(relation.t, interfaceParameters, expectedRef,
        expectedParameters, depth + 1))
        return true;
    }
    return false;
  }

  /** Returns the explicit runtime-global path owned by one extern class. */
  static function nativeGlobalIdentity(type: ClassType): Null<String> {
    if (!type.isExtern || metadata(type.meta, 'jsRequire').length > 0)
      return null;
    final entries = metadata(type.meta, 'native');
    return switch entries {
      case [{params: [{expr: EConst(CString(value, _))}]}]
        if (StringTools.trim(value).length > 0):
        value;
      default: null;
    }
  }

  /**
   * Checks one directional React event assignment without erasing its target.
   *
   * Why: a callback parameter is checked in the opposite direction from its
   * callback value. An anchor click may be passed to a handler that accepts a
   * general synthetic DOM event, but a general event may not be passed to a
   * handler that requires an anchor mouse event. Haxe can otherwise treat the
   * generic parameter on these externs as decoration because it adds no
   * runtime field.
   *
   * What: `actual` is the event value the caller may provide and `expected` is
   * the event type the destination can receive. The actual event family must
   * be the same declaration or inherit from the expected family. Its element
   * parameter must likewise be the same target or a real subtype.
   *
   * How: the walk follows compiler-owned class relations and substitutes their
   * type parameters before comparing them. It never relies on emitted React
   * names or structural unification. `Null` means neither side is one of the
   * closed Genes React event contracts, so normal HXX assignability continues.
   */
  static function reactEventAssignability(actual: Type, expected: Type,
      depth: Int): Null<Bool> {
    if (depth > 64)
      return false;
    return switch [resolveAliases(actual), resolveAliases(expected)] {
      case [TInst(actualRef,
        actualParameters), TInst(expectedRef, expectedParameters)]:
        final actualType = actualRef.get();
        final expectedType = expectedRef.get();
        if (!isReactEventType(actualType) || !isReactEventType(expectedType))
          null; else if (sameClassIdentity(actualType, expectedType)) {
          if (actualParameters.length != expectedParameters.length)
            false;
          else {
            var compatible = true;
            for (index in 0...actualParameters.length)
              if (!reactEventTargetAssignable(actualParameters[index],
                expectedParameters[index], depth + 1)) {
                compatible = false;
                break;
              }
            compatible;
          }
        } else if (actualType.superClass == null) {
          false;
        } else {
          final relation = actualType.superClass;
          final parentParameters = [
            for (parameter in relation.params)
              TypeTools.applyTypeParameters(parameter, actualType.params,
                actualParameters)
          ];
          reactEventAssignability(TInst(relation.t, parentParameters),
            TInst(expectedRef, expectedParameters), depth + 1) == true;
        }
      default: null;
    }
  }

  /**
   * Returns whether this is one of the five event declarations we reviewed.
   *
   * Why: the covariance proof belongs to these declarations, not to their
   * familiar package or class names. Haxe 4.3.7 rejects a loaded duplicate
   * such as another `genes.react.MouseEvent`, but this semantic owner should
   * still state the exact declaration boundary instead of depending on that
   * separate name-collision rule.
   *
   * How: a Haxe class is identified by both its module and declaration name.
   * Matching the exact pair keeps the rule closed and makes future module
   * resolution changes fail safely.
   */
  static function isReactEventType(type: ClassType): Bool {
    return switch [type.module, type.name] {
      case ['genes.react.ChangeEvent', 'ChangeEvent'] |
        ['genes.react.MouseEvent', 'MouseEvent'] |
        ['genes.react.KeyboardEvent', 'KeyboardEvent'] |
        ['genes.react.FocusEvent', 'FocusEvent'] |
        ['genes.react.SyntheticEvent', 'SyntheticEvent']:
        true;
      default: false;
    }
  }

  /** Compares compiler declaration identity without using generated names. */
  static function sameClassIdentity(left: ClassType, right: ClassType): Bool {
    return left.module == right.module && left.name == right.name;
  }

  /**
   * Checks the target parameter carried by a reviewed React event facade.
   *
   * The bundled facades expose the target only through read-only event fields,
   * so a concrete target may safely flow to a handler accepting its base type.
   * The compiler follows nominal Haxe inheritance instead of structural
   * unification: two empty externs are not related merely because neither has
   * a runtime field.
   */
  static function reactEventTargetAssignable(actual: Type, expected: Type,
      depth: Int): Bool {
    if (depth > 64)
      return false;
    final actualBrowser = browserElementIdentity(actual);
    final expectedBrowser = browserElementIdentity(expected);
    if (actualBrowser != null || expectedBrowser != null)
      return actualBrowser != null && expectedBrowser != null
        && browserElementAssignable(actualBrowser, expectedBrowser);
    return switch [resolveAliases(actual), resolveAliases(expected)] {
      case [TInst(actualRef,
        actualParameters), TInst(expectedRef, expectedParameters)]:
        classTargetAssignable(actualRef, actualParameters, expectedRef,
          expectedParameters, depth + 1);
      default: sameInvariantType(actual, expected, depth + 1);
    }
  }

  /** Follows real class/interface relations for a non-browser event target. */
  static function classTargetAssignable(actualRef: Ref<ClassType>,
      actualParameters: Array<Type>, expectedRef: Ref<ClassType>,
      expectedParameters: Array<Type>, depth: Int): Bool {
    if (depth > 64)
      return false;
    final actualType = actualRef.get();
    final expectedType = expectedRef.get();
    if (sameClassIdentity(actualType, expectedType))
      return sameTypeParameters(actualParameters, expectedParameters,
        depth + 1);
    if (actualType.superClass != null) {
      final relation = actualType.superClass;
      final parentParameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actualType.params,
            actualParameters)
      ];
      if (reactEventTargetAssignable(TInst(relation.t, parentParameters),
        TInst(expectedRef, expectedParameters), depth + 1))
        return true;
    }
    for (relation in actualType.interfaces) {
      final interfaceParameters = [
        for (parameter in relation.params)
          TypeTools.applyTypeParameters(parameter, actualType.params,
            actualParameters)
      ];
      if (reactEventTargetAssignable(TInst(relation.t, interfaceParameters),
        TInst(expectedRef, expectedParameters), depth + 1))
        return true;
    }
    return false;
  }

  /** Directional relationship shared by Genes and standard DOM identities. */
  static function browserElementAssignable(actual: JsxBrowserElementIdentity,
      expected: JsxBrowserElementIdentity): Bool {
    if (actual == expected)
      return true;
    return expected == HtmlElement
      && (actual == AnchorElement || actual == InputElement);
  }

  static function sameInvariantType(left: Type, right: Type, depth: Int): Bool {
    if (depth > 64)
      return false;
    final leftBrowser = browserElementIdentity(left);
    final rightBrowser = browserElementIdentity(right);
    if (leftBrowser != null || rightBrowser != null)
      return leftBrowser != null && leftBrowser == rightBrowser;
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

  static function browserElementIdentity(type: Type): Null<JsxBrowserElementIdentity> {
    return switch resolveAliases(type) {
      case TInst(classRef, _):
        final owner = classRef.get();
        // Haxe's JS DOM externs use their JavaScript class name as the typed
        // declaration name (for example `HTMLAnchorElement`) while keeping the
        // Haxe module path (`js.html.AnchorElement`). Compare both compiler
        // identities rather than their source spelling or generated TS text.
        switch [owner.module, owner.name] {
          case ['genes.react.DomElement', 'DomElement'] |
            ['js.html.Element', 'HTMLElement']:
            HtmlElement;
          case ['genes.react.AnchorElement', 'AnchorElement'] |
            ['js.html.AnchorElement', 'HTMLAnchorElement']:
            AnchorElement;
          case ['genes.react.InputElement', 'InputElement'] |
            ['js.html.InputElement', 'HTMLInputElement']:
            InputElement;
          default: null;
        }
      default: null;
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

  /**
   * Returns the value carried by one or more explicit undefined boundaries.
   *
   * Why: `@:optional` describes whether a property may be omitted, while
   * `Undefinable<T>` describes a value supplied as JavaScript `undefined`.
   * Most HXX component contracts keep those rules separate. A provider may
   * opt in when its TypeScript API explicitly accepts supplied undefined.
   *
   * How: callers first ask `NullishContract` whether undefined is intentional,
   * then this helper removes only the named boundary abstract. It never removes
   * `Null<T>`, so accepting `undefined` cannot accidentally accept Haxe `null`.
   */
  static function stripExplicitUndefined(type: Type, depth = 0): Type {
    if (depth > 64)
      return type;
    final inner = undefinableInner(type);
    return inner == null ? type : stripExplicitUndefined(inner, depth + 1);
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

  /**
   * Rejects weak types only where the property contract can observe them.
   *
   * Why: Haxe and TypeScript both allow a callback that returns a value where
   * a `Void` callback is expected. Event handlers commonly use this to start
   * an async operation; React ignores the returned promise. The promise may
   * contain an `Unknown` value from a typed network boundary, but that value is
   * not the HXX property's value and is never exposed through the callback
   * contract.
   *
   * How: callback parameters and every non-ignored result are still checked
   * recursively. Only the actual result paired with an expected `Void` result
   * is skipped. Other values continue through the strict deep check below, so
   * containers such as `Array<Dynamic>` remain rejected.
   */
  static function rejectUnsafeForExpected(actual: Type, expected: Type,
      pos: Position, literalNull: Bool): Void {
    // A literal null is a precise authored value, not an unresolved boundary.
    // Assignability below decides whether the destination admits it.
    if (literalNull)
      return;
    if (hasObservableUnsafeType(actual, expected, 0))
      fail('GTS-HXX-TYPE-001',
        'HXX values must have a resolved concrete Haxe ' +
        'type; received `${typeName(actual)}`',
        pos);
  }

  static function hasObservableUnsafeType(actual: Type, expected: Type,
      depth: Int): Bool {
    if (depth > 64)
      return true;
    final absentExpected = undefinableInner(expected);
    if (absentExpected != null)
      return hasObservableUnsafeType(actual, absentExpected, depth + 1);
    final nullableExpected = nullableInner(expected);
    if (nullableExpected != null)
      return hasObservableUnsafeType(actual, nullableExpected, depth + 1);
    final absentActual = undefinableInner(actual);
    if (absentActual != null)
      return hasObservableUnsafeType(absentActual, expected, depth + 1);
    switch [resolveAliases(actual), resolveAliases(expected)] {
      case [TFun(actualArgs, actualResult), TFun(_, expectedResult)]:
        return hasUnsafeFunctionArgument(actualArgs, depth + 1)
          || (!isVoid(expectedResult)
            && hasObservableUnsafeType(actualResult, expectedResult,
              depth + 1));
      default:
    }
    return isUnsafe(actual, depth);
  }

  static function hasUnsafeFunctionArgument(arguments: Array<JsxFunctionArgument>,
    depth: Int): Bool {
    for (argument in arguments)
      if (isUnsafe(argument.t, depth))
        return true;
    return false;
  }

  /**
   * Rejects weak types even when they are nested inside a safe container.
   *
   * Recursive typedefs are legal closed contracts. While a typedef is already
   * being inspected, seeing that same typedef with the same type arguments
   * means the walk has returned to a shape it is currently checking; it does
   * not mean the type is unresolved. The active stack uses Haxe's typed typedef
   * reference plus readable argument spellings only as a recursion guard. It
   * never decides assignability or generated names.
   */
  static function isUnsafe(type: Type, depth = 0,
      visiting: Null<Array<JsxUnsafeVisit>> = null,
      allowInferenceVariables = false): Bool {
    if (depth > 64)
      return true;
    final active = visiting == null ? [] : visiting;
    final nextDepth = depth + 1;
    return switch type {
      case TType(typeRef, parameters):
        final arguments = [
          for (parameter in parameters)
            TypeTools.toString(parameter)
        ];
        var recursive = false;
        for (visit in active)
          if (sameTypedefOwner(visit.owner, typeRef)
            && sameStrings(visit.arguments, arguments)) {
            recursive = true;
            break;
          }
        if (recursive) false; else {
          active.push({owner: typeRef, arguments: arguments});
          final unsafe = isUnsafe(Context.follow(type), nextDepth, active,
            allowInferenceVariables);
          active.pop();
          unsafe;
        }
      case TLazy(resolve):
        isUnsafe(resolve(), nextDepth, active, allowInferenceVariables);
      case TMono(reference):
        isUnsafeMonomorph(reference, nextDepth, active,
          allowInferenceVariables);
      case TInst(classRef, _) if (classRef.get().kind.match(KTypeParameter(_))):
        // A named type parameter is a checked symbolic contract, not an
        // unresolved monomorph. Assignability binds or validates it later.
        false;
      case TDynamic(_): true;
      case TAbstract(abstractRef, _):
        if (isUnsafeAbstract(abstractRef.get())) true; else
          hasUnsafeChild(type, nextDepth, active, allowInferenceVariables);
      default:
        hasUnsafeChild(type, nextDepth, active, allowInferenceVariables);
    }
  }

  static function isUnsafeSchema(type: Type): Bool {
    // Generic component functions expose fresh Haxe monomorphs while their
    // HXX arguments are being inferred. They are checked inference variables,
    // not weak application values; prop validation binds them immediately.
    return isUnsafe(type, 0, null, true);
  }

  static function isUnsafeAbstract(type: AbstractType): Bool {
    final coreAny = type.pack.length == 0 && type.name == 'Any';
    final genesUnknown = type.pack.join('.') == 'genes.ts'
      && type.name == 'Unknown';
    return coreAny || genesUnknown;
  }

  static function hasUnsafeChild(type: Type, depth: Int,
      visiting: Array<JsxUnsafeVisit>, allowInferenceVariables: Bool): Bool {
    var unsafe = false;
    TypeTools.iter(type, child -> {
      if (!unsafe && isUnsafe(child, depth, visiting, allowInferenceVariables))
        unsafe = true;
    });
    return unsafe;
  }

  static function isUnsafeMonomorph(reference: Ref<Null<Type>>, depth: Int,
      visiting: Array<JsxUnsafeVisit>, allowInferenceVariables: Bool): Bool {
    final resolved = reference.get();
    return resolved == null ? !allowInferenceVariables : isUnsafe(resolved,
      depth, visiting, allowInferenceVariables);
  }

  static function sameStrings(left: Array<String>, right: Array<String>): Bool {
    if (left.length != right.length)
      return false;
    for (index in 0...left.length)
      if (left[index] != right[index])
        return false;
    return true;
  }

  static function sameTypedefOwner(left: Ref<DefType>,
      right: Ref<DefType>): Bool {
    final leftType = left.get();
    final rightType = right.get();
    return leftType.module == rightType.module
      && leftType.name == rightType.name;
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
    final entries = metadata(meta, name);
    if (entries.length > 1)
      fail('GTS-HXX-SCHEMA-010', '@:$name may appear only once on a field',
        entries[1].pos);
    return switch entries {
      case []: null;
      case [entry]: switch entry.params {
          case [{expr: EConst(CString(value, _))}]: {
              value: value,
              pos: entry.pos
            };
          default:
            fail('GTS-HXX-SCHEMA-005',
              '@:$name expects exactly one string literal', entry.pos);
        }
      default: null;
    }
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
