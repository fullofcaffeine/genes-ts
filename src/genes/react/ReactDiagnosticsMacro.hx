package genes.react;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.Type.ClassField;
import haxe.macro.Type.ClassType;
import haxe.macro.Type.FieldAccess;

using Lambda;
using haxe.macro.TypeTools;

private enum ReactFunctionKind {
	OrdinaryFunction;
	ReactComponent;
	CustomHook;
}

private enum ReactCallKind {
	ReviewedHook(owner:ClassType, field:ClassField);
	ReactUse(owner:ClassType, field:ClassField);
	KnownImpure(label:String);
}

private typedef ReactPlacement = {
	final functionKind:ReactFunctionKind;
	final conditional:Bool;
	final loop:Bool;
	final nestedFunction:Bool;
	final protectedBlock:Bool;
	final afterEarlyReturn:Bool;
}

private typedef ReturnFlow = {
	final mayReturn:Bool;
	final alwaysReturns:Bool;
}
#end

/**
 * Audits locally provable React Hook placement and render-purity mistakes.
 *
 * Calls are classified from typed field identity and reviewed metadata. Names
 * alone never turn an ordinary Haxe function into a Hook.
 *
 * This is a compiler-only module because the pass owns no runtime object,
 * inheritance contract, or constructible identity.
 */
#if macro
private inline final COMPONENT_METADATA = ":genes.reactComponent";
private inline final HOOK_METADATA = ":genes.reactHook";
private inline final REACT_USE_METADATA = ":genes.reactUse";
private final NO_RETURN:ReturnFlow = {mayReturn: false, alwaysReturns: false};
private var installed:Bool = false;

private function fail<T>(code:String, message:String, position:Position):T {
		return Context.fatalError('[$code] $message', position);
	}

private function fullTypeName(type:ClassType):String {
		final primaryTypeName = type.pack.concat([type.name]).join(".");
		return type.module == primaryTypeName ? primaryTypeName : '${type.module}.${type.name}';
	}

private function fieldLabel(owner:ClassType, field:ClassField):String {
		if (owner.module == "genes.react.ReactHookBindings"
			&& owner.name == "ReactHookBindings") {
			return switch field.name {
				case "useStateValue": "genes.react.React.useState";
				case "useStateLazy": "genes.react.React.useStateLazy";
				case "useMemo": "genes.react.React.useMemo";
				case "useCallback": "genes.react.React.useCallback";
				case "useOptimistic": "genes.react.React.useOptimistic";
				case _: '${fullTypeName(owner)}.${field.name}';
			};
		}
		return '${fullTypeName(owner)}.${field.name}';
	}

private function placement(functionKind:ReactFunctionKind):ReactPlacement {
		return {
			functionKind: functionKind,
			conditional: false,
			loop: false,
			nestedFunction: false,
			protectedBlock: false,
			afterEarlyReturn: false
		};
	}

private function withConditional(value:ReactPlacement):ReactPlacement {
		return {
			functionKind: value.functionKind,
			conditional: true,
			loop: value.loop,
			nestedFunction: value.nestedFunction,
			protectedBlock: value.protectedBlock,
			afterEarlyReturn: value.afterEarlyReturn
		};
	}

private function withLoop(value:ReactPlacement):ReactPlacement {
		return {
			functionKind: value.functionKind,
			conditional: value.conditional,
			loop: true,
			nestedFunction: value.nestedFunction,
			protectedBlock: value.protectedBlock,
			afterEarlyReturn: value.afterEarlyReturn
		};
	}

private function withNestedFunction(value:ReactPlacement):ReactPlacement {
		return {
			functionKind: value.functionKind,
			conditional: value.conditional,
			loop: value.loop,
			nestedFunction: true,
			protectedBlock: value.protectedBlock,
			afterEarlyReturn: false
		};
	}

private function withProtectedBlock(value:ReactPlacement):ReactPlacement {
		return {
			functionKind: value.functionKind,
			conditional: value.conditional,
			loop: value.loop,
			nestedFunction: value.nestedFunction,
			protectedBlock: true,
			afterEarlyReturn: value.afterEarlyReturn
		};
	}

private function withEarlyReturn(value:ReactPlacement):ReactPlacement {
		return {
			functionKind: value.functionKind,
			conditional: value.conditional,
			loop: value.loop,
			nestedFunction: value.nestedFunction,
			protectedBlock: value.protectedBlock,
			afterEarlyReturn: true
		};
	}

private function mergeFlows(values:Array<ReturnFlow>):ReturnFlow {
		return {
			mayReturn: values.exists(value -> value.mayReturn),
			alwaysReturns: values.length > 0 && values.foreach(value -> value.alwaysReturns)
		};
	}

private function fieldAccess(value:FieldAccess):Null<{final owner:ClassType; final field:ClassField;}> {
		return switch value {
			case FInstance(owner, _, field) | FStatic(owner, field):
				{owner: owner.get(), field: field.get()};
			case FClosure(owner, field) if (owner != null):
				{owner: owner.c.get(), field: field.get()};
			case _:
				null;
		};
	}

private function unwrapCallee(expression:TypedExpr):TypedExpr {
		return switch expression.expr {
			case TParenthesis(inner) | TCast(inner, _) | TMeta(_, inner): unwrapCallee(inner);
			case _: expression;
		};
	}

private function callKind(callee:TypedExpr):Null<ReactCallKind> {
		final expression = unwrapCallee(callee);
		return switch expression.expr {
			case TField(_, access):
				final resolved = fieldAccess(access);
				if (resolved == null) {
					null;
				} else if (resolved.field.meta.has(REACT_USE_METADATA)) {
					ReactUse(resolved.owner, resolved.field);
				} else if (resolved.field.meta.has(HOOK_METADATA)) {
					ReviewedHook(resolved.owner, resolved.field);
				} else if (resolved.owner.module == "Math" && resolved.field.name == "random") {
					KnownImpure("Math.random");
				} else if (resolved.owner.module == "Date" && resolved.field.name == "now") {
					KnownImpure("Date.now");
				} else {
					null;
				}
			case _:
				null;
		};
	}

private function isReactFunction(value:ReactPlacement):Bool {
		return switch value.functionKind {
			case ReactComponent | CustomHook: true;
			case OrdinaryFunction: false;
		};
	}

private function hookPlacementReason(value:ReactPlacement):Null<String> {
		if (value.nestedFunction) {
			return "a nested function or event-handler callback";
		}
		if (value.protectedBlock) {
			return "a try/catch block";
		}
		if (value.loop) {
			return "a loop";
		}
		if (value.conditional) {
			return "a conditional branch";
		}
		if (value.afterEarlyReturn) {
			return "code reached after a conditional early return";
		}
		return null;
	}

private function validateHookCall(owner:ClassType, field:ClassField, value:ReactPlacement, position:Position):Void {
		final label = fieldLabel(owner, field);
		if (!isReactFunction(value)) {
			fail("GTS-REACT-HOOK-001",
				'Reviewed React Hook $label may only be called from a @:genes.reactComponent or @:genes.reactHook function. Mark a genuine component or custom Hook; keep ordinary helpers Hook-free.',
				position);
		}
		final reason = hookPlacementReason(value);
		if (reason != null) {
			fail("GTS-REACT-HOOK-002",
				'Reviewed React Hook $label is called inside $reason. Call Hooks unconditionally at the top level of the component or custom Hook, before any conditional early return.',
				position);
		}
	}

private function validateReactUse(owner:ClassType, field:ClassField, value:ReactPlacement, position:Position):Void {
		final label = fieldLabel(owner, field);
		if (!isReactFunction(value)) {
			fail("GTS-REACT-USE-003", 'React use binding $label may only be called from a @:genes.reactComponent or @:genes.reactHook function.',
				position);
		}
		if (value.nestedFunction) {
			fail("GTS-REACT-USE-003",
				'React use binding $label cannot be called from a nested function or event-handler callback. Call it directly while the component or custom Hook is rendering.',
				position);
		}
		if (value.protectedBlock) {
			fail("GTS-REACT-USE-003",
				'React use binding $label cannot be called inside try/catch because React uses throwing to suspend. Use an Error Boundary; conditions and loops remain valid for React use.',
				position);
		}
	}

private function isCurrentDateConstruction(callee:TypedExpr, arguments:Array<TypedExpr>):Bool {
		if (arguments.length != 1) {
			return false;
		}
		final resolved = switch unwrapCallee(callee).expr {
			case TField(_, access): fieldAccess(access);
			case _: null;
		};
		if (resolved == null || resolved.owner.module != "js.Syntax" || resolved.field.name != "construct") {
			return false;
		}
		return switch unwrapCallee(arguments[0]).expr {
			case TTypeExpr(TClassDecl(type)): type.get().module == "Date";
			case _: false;
		};
	}

private function failImpureCall(label:String, value:ReactPlacement, position:Position):Void {
		if (isReactFunction(value) && !value.nestedFunction) {
			fail("GTS-REACT-PURITY-004",
				'React render calls known non-idempotent function $label. Pass a stable value, initialize state lazily, or move the call into an event handler or Effect.',
				position);
		}
	}

private function validateCall(call:TypedExpr, callee:TypedExpr, arguments:Array<TypedExpr>, value:ReactPlacement):Void {
		if (isCurrentDateConstruction(callee, arguments)) {
			failImpureCall("Date.now", value, call.pos);
		}
		final kind = callKind(callee);
		if (kind == null) {
			validateOrdinaryUseName(callee, value, call.pos);
			return;
		}
		switch kind {
			case ReviewedHook(owner, field):
				validateHookCall(owner, field, value, call.pos);
			case ReactUse(owner, field):
				validateReactUse(owner, field, value, call.pos);
			case KnownImpure(label):
				failImpureCall(label, value, call.pos);
		}
	}

private function validateOrdinaryUseName(callee:TypedExpr, value:ReactPlacement, position:Position):Void {
		if (!isReactFunction(value)) {
			return;
		}
		final expression = unwrapCallee(callee);
		final resolved = switch expression.expr {
			case TField(_, access): fieldAccess(access);
			case _: null;
		};
		if (resolved == null || !~/^use(?:$|[A-Z0-9])/.match(resolved.field.name)) {
			return;
		}
		fail("GTS-REACT-NAME-006",
			'Ordinary function ${fieldLabel(resolved.owner, resolved.field)} uses React\'s reserved use-prefixed spelling inside a component or custom Hook. Haxe does not classify it as a Hook, but official React lint must treat that emitted name as one. Rename the ordinary helper without the use prefix, or mark and structure a genuine Hook with @:genes.reactHook.',
			position);
	}

private function validateConstruction(type:ClassType, arguments:Array<TypedExpr>, value:ReactPlacement, position:Position):Void {
		if (type.module == "Date" && arguments.length == 0) {
			failImpureCall("Date.now", value, position);
		}
	}

private function staticFieldTarget(expression:TypedExpr):Null<{final owner:ClassType; final field:ClassField;}> {
		final value = unwrapCallee(expression);
		return switch value.expr {
			case TField(_, access):
				final resolved = fieldAccess(access);
				switch access {
					case FStatic(_, _): resolved;
					case _: null;
				}
			case _:
				null;
		};
	}

private function validateStaticMutation(target:TypedExpr, value:ReactPlacement, position:Position):Void {
		if (!isReactFunction(value) || value.nestedFunction) {
			return;
		}
		final resolved = staticFieldTarget(target);
		if (resolved != null) {
			fail("GTS-REACT-PURITY-004",
				'React render mutates non-local static field ${fieldLabel(resolved.owner, resolved.field)}. Create per-render local data, or update state from an event handler or Effect.',
				position);
		}
	}

private function analyzeList(expressions:Array<TypedExpr>, value:ReactPlacement):ReturnFlow {
		final flows = [for (expression in expressions) analyze(expression, value)];
		return {
			mayReturn: flows.exists(flow -> flow.mayReturn),
			alwaysReturns: false
		};
	}

private function analyzeBlock(expressions:Array<TypedExpr>, value:ReactPlacement):ReturnFlow {
		var current = value;
		var mayReturn = false;
		var alwaysReturns = false;
		for (expression in expressions) {
			if (alwaysReturns) {
				break;
			}
			final flow = analyze(expression, current);
			mayReturn = mayReturn || flow.mayReturn;
			if (flow.alwaysReturns) {
				alwaysReturns = true;
			} else if (flow.mayReturn) {
				current = withEarlyReturn(current);
			}
		}
		return {mayReturn: mayReturn, alwaysReturns: alwaysReturns};
	}

private function analyze(expression:TypedExpr, value:ReactPlacement):ReturnFlow {
		return switch expression.expr {
			case TConst(_) | TLocal(_) | TTypeExpr(_) | TBreak | TContinue | TIdent(_):
				NO_RETURN;
			case TArray(left, right):
				analyzeList([left, right], value);
			case TBinop(op, left, right): switch op {
					case OpAssign | OpAssignOp(_): validateStaticMutation(left, value, expression.pos);
					case _:
				} final rightPlacement = switch op {
					case OpBoolAnd | OpBoolOr | OpNullCoal: withConditional(value);
					case _: value;
				}; analyzeList([left], value).mayReturn || analyze(right, rightPlacement).mayReturn ? {mayReturn: true, alwaysReturns: false} : NO_RETURN;
			case TField(target, _):
				analyze(target, value);
			case TParenthesis(inner) | TCast(inner, _) | TMeta(_, inner) | TEnumParameter(inner, _, _) | TEnumIndex(inner):
				analyze(inner, value);
			case TObjectDecl(fields):
				analyzeList([for (field in fields) field.expr], value);
			case TArrayDecl(expressions):
				analyzeList(expressions, value);
			case TCall(callee, arguments):
				validateCall(expression, callee, arguments, value);
				analyzeList([callee].concat(arguments), value);
			case TNew(type, _, arguments):
				validateConstruction(type.get(), arguments, value, expression.pos);
				analyzeList(arguments, value);
			case TUnop(op, _, inner):
				switch op {
					case OpIncrement | OpDecrement: validateStaticMutation(inner, value, expression.pos);
					case _:
				}
				analyze(inner, value);
			case TFunction(functionValue):
				analyze(functionValue.expr, withNestedFunction(value));
				NO_RETURN;
			case TVar(_, initializer):
				initializer == null ? NO_RETURN : analyze(initializer, value);
			case TBlock(expressions):
				analyzeBlock(expressions, value);
			case TFor(_, iterator, body):
				final loopPlacement = withLoop(value);
				final flow = mergeFlows([analyze(iterator, value), analyze(body, loopPlacement)]);
				{mayReturn: flow.mayReturn, alwaysReturns: false};
			case TIf(condition, positive, negative):
				final conditionFlow = analyze(condition, value);
				final branchPlacement = withConditional(value);
				final positiveFlow = analyze(positive, branchPlacement);
				final negativeFlow = negative == null ? NO_RETURN : analyze(negative, branchPlacement);
				{
					mayReturn: conditionFlow.mayReturn || positiveFlow.mayReturn || negativeFlow.mayReturn,
					alwaysReturns: conditionFlow.alwaysReturns
					|| (negative != null && positiveFlow.alwaysReturns && negativeFlow.alwaysReturns)};
			case TWhile(condition, body, _):
				final loopPlacement = withLoop(value);
				final flow = mergeFlows([analyze(condition, loopPlacement), analyze(body, loopPlacement)]);
				{mayReturn: flow.mayReturn, alwaysReturns: false};
			case TSwitch(subject, cases, fallback):
				final subjectFlow = analyze(subject, value);
				final branchPlacement = withConditional(value);
				final branchFlows = [for (caseValue in cases) analyze(caseValue.expr, branchPlacement)];
				final fallbackFlow = fallback == null ? NO_RETURN : analyze(fallback, branchPlacement);
				{
					mayReturn: subjectFlow.mayReturn || branchFlows.exists(flow -> flow.mayReturn) || fallbackFlow.mayReturn,
					alwaysReturns: subjectFlow.alwaysReturns
					|| (fallback != null
						&& branchFlows.length > 0
						&& branchFlows.foreach(flow -> flow.alwaysReturns)
						&& fallbackFlow.alwaysReturns)};
			case TTry(body, catches):
				final protectedPlacement = withProtectedBlock(value);
				final bodyFlow = analyze(body, protectedPlacement);
				final catchFlows = [for (catchValue in catches) analyze(catchValue.expr, protectedPlacement)];
				{
					mayReturn: bodyFlow.mayReturn || catchFlows.exists(flow -> flow.mayReturn),
					alwaysReturns: bodyFlow.alwaysReturns && catchFlows.foreach(flow -> flow.alwaysReturns)
				};
			case TReturn(result):
				if (result != null) {
					analyze(result, value);
				}
				{mayReturn: true, alwaysReturns: true};
			case TThrow(inner):
				analyze(inner, value);
		};
	}

private function metadataEntries(field:ClassField, name:String):Array<MetadataEntry> {
		return field.meta.get().filter(entry -> entry.name == name);
	}

private function validateMetadata(type:ClassType, field:ClassField, isStatic:Bool):Void {
		final components = metadataEntries(field, COMPONENT_METADATA);
		final hooks = metadataEntries(field, HOOK_METADATA);
		final reactUses = metadataEntries(field, REACT_USE_METADATA);
		final entries = components.concat(hooks).concat(reactUses);
		if (components.length > 1 || hooks.length > 1 || reactUses.length > 1
			|| entries.length > 1) {
			final position = entries.length > 1 ? entries[1].pos : entries[0].pos;
			fail("GTS-REACT-METADATA-005",
				'${fieldLabel(type, field)} must declare exactly one React component, Hook, or use-binding role.',
				position);
		}
		final entry = entries.length == 1 ? entries[0] : null;
		if (entry == null) {
			return;
		}
		if (entry.params.length != 0) {
			fail("GTS-REACT-METADATA-005",
				'@${entry.name.substr(1)} on ${fieldLabel(type, field)} does not accept arguments.',
				entry.pos);
		}
		if (!isStatic) {
			fail("GTS-REACT-METADATA-005",
				'@${entry.name.substr(1)} requires a static or module-level function; ${fieldLabel(type, field)} is an instance field.', entry.pos);
		}
		switch field.type.follow() {
			case TFun(_, _):
			case _:
				fail("GTS-REACT-METADATA-005",
					'@${entry.name.substr(1)} may annotate only a function; found ${field.type.toString()}.',
					entry.pos);
		}
		if (hooks.length == 1 && !~/^use(?:$|[A-Z0-9])/.match(field.name)) {
			fail("GTS-REACT-METADATA-005",
				'Custom Hook ${fieldLabel(type, field)} must retain React\'s use-prefixed naming convention as well as declaring @:genes.reactHook.',
				entry.pos);
		}
		if (components.length == 1 && !~/^[A-Z]/.match(field.name)) {
			fail("GTS-REACT-METADATA-005",
				'React component ${fieldLabel(type, field)} must begin with an uppercase letter so React and its analyzers preserve component identity.',
				entry.pos);
		}
		if (reactUses.length == 1 && field.expr() != null) {
			fail("GTS-REACT-METADATA-005",
				'@:genes.reactUse is reserved for an extern binding to React use; ${fieldLabel(type, field)} has a Haxe body.',
				entry.pos);
		}
	}

private function auditField(type:ClassType, field:ClassField, isStatic:Bool):Void {
		validateMetadata(type, field, isStatic);
		final expression = field.expr();
		if (expression == null) {
			return;
		}
		final functionKind = if (field.meta.has(COMPONENT_METADATA)) {
			ReactComponent;
		} else if (field.meta.has(HOOK_METADATA)) {
			CustomHook;
		} else {
			OrdinaryFunction;
		};
		final root = placement(functionKind);
		switch expression.expr {
			case TFunction(functionValue):
				analyze(functionValue.expr, root);
			case _:
				analyze(expression, root);
		}
	}

private function auditClass(type:ClassType):Void {
		for (field in type.statics.get()) {
			auditField(type, field, true);
		}
		for (field in type.fields.get()) {
			auditField(type, field, false);
		}
		if (type.constructor != null) {
			auditField(type, type.constructor.get(), false);
		}
		if (type.init != null) {
			analyze(type.init, placement(OrdinaryFunction));
		}
	}

private function audit(types:Array<ModuleType>):Void {
		for (type in types) {
			switch type {
				case TClassDecl(reference):
					auditClass(reference.get());
				case _:
			}
		}
	}
/** Installs one typed React diagnostics pass for the compilation. */
function install():Void {
		if (installed) {
			return;
		}
		installed = true;
		ReactAnalyzerFunctionMacro.install();
		Context.onAfterTyping(audit);
	}
#end
