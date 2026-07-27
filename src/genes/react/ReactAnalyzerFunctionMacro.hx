package genes.react;

#if macro
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type.ClassKind;
import haxe.macro.Type.ClassType;

using Lambda;
#end

/**
 * Adds analyzer-visible module-function metadata to reviewed React bodies.
 *
 * This is compiler-only module behavior: no runtime or constructible identity
 * exists, so module fields keep the implementation aligned with the emitted
 * JavaScript/TypeScript module-function contract.
 */
#if macro
private inline final COMPONENT_METADATA = ":genes.reactComponent";
private inline final HOOK_METADATA = ":genes.reactHook";
private inline final MODULE_FUNCTION_METADATA = ":genes.moduleFunction";
private var installed:Bool = false;

private function fail<T>(code:String, message:String, position:Position):T {
		return Context.fatalError('[$code] $message', position);
	}

private function fullTypeName(type:ClassType):String {
		final primaryTypeName = type.pack.concat([type.name]).join(".");
		return type.module == primaryTypeName ? primaryTypeName : '${type.module}.${type.name}';
	}

private function hasAccess(field:Field, access:Access):Bool {
		return field.access != null && field.access.contains(access);
	}

	/**
	 * Makes a reviewed React body visible to ordinary JavaScript analyzers.
	 *
	 * The marker is compiler plumbing, not application-facing ceremony:
	 * genes-ts moves the typed body to one genuine module function while keeping
	 * the Haxe field as the same callable value. The reviewed React marker
	 * supplies the React-significant name without introducing host-framework
	 * knowledge.
	 */
private function markModuleFunction(field:Field, emittedName:String, position:Position):Void {
		final metadata = field.meta == null ? [] : field.meta;
		if (metadata.exists(entry -> entry.name == MODULE_FUNCTION_METADATA)) {
			fail("GTS-REACT-ANALYZER-006",
				'${field.name} must not combine a reviewed React marker with @:genes.moduleFunction; genes.react derives the analyzer-visible function name.',
				position);
		}
		metadata.push({
			name: MODULE_FUNCTION_METADATA,
			params: [{expr: EConst(CString(emittedName, DoubleQuotes)), pos: position}],
			pos: position
		});
		field.meta = metadata;
	}

private function markHaxeHooks(type:ClassType, fields:Array<Field>):Void {
		if (type.isExtern || type.isInterface) {
			return;
		}
		for (field in fields) {
			final metadata = field.meta == null ? [] : field.meta;
			if (!metadata.exists(entry -> entry.name == HOOK_METADATA)) {
				continue;
			}
			switch field.kind {
				case FFun(method) if (method.expr != null):
					final isModuleField = type.kind.match(KModuleFields(_));
					if (!isModuleField
						&& (!hasAccess(field, APublic) || !hasAccess(field, AStatic))) {
						fail("GTS-REACT-ANALYZER-006",
							'Haxe-authored Hook ${fullTypeName(type)}.${field.name} must be a module-level function or public static method so its checked body can be emitted as an analyzer-visible module function.',
							field.pos);
					}
					markModuleFunction(field, field.name, field.pos);
				case _:
			}
		}
	}

private function markReactComponents(type:ClassType, fields:Array<Field>):Void {
		if (type.isExtern || type.isInterface) {
			return;
		}
		for (field in fields) {
			final metadata = field.meta == null ? [] : field.meta;
			if (!metadata.exists(entry -> entry.name == COMPONENT_METADATA)) {
				continue;
			}
			switch field.kind {
				case FFun(method) if (method.expr != null):
					final isModuleField = type.kind.match(KModuleFields(_));
					if (!isModuleField
						&& (!hasAccess(field, APublic) || !hasAccess(field, AStatic))) {
						fail("GTS-REACT-ANALYZER-006",
							'Haxe-authored component ${fullTypeName(type)}.${field.name} must be a module-level function or public static method so its checked body can be emitted as an analyzer-visible module function.',
							field.pos);
					}
					markModuleFunction(field, field.name, field.pos);
				case _:
			}
		}
	}

function install():Void {
		if (installed) {
			return;
		}
		installed = true;
		Compiler.addGlobalMetadata("", "@:build(genes.react.ReactAnalyzerFunctionMacro.build())", true, true, false);
	}

function build():Array<Field> {
		final fields = Context.getBuildFields();
		final localClass = Context.getLocalClass();
		if (localClass == null) {
			return fields;
		}
		final type = localClass.get();
		markHaxeHooks(type, fields);
		markReactComponents(type, fields);
		return fields;
	}
#end
