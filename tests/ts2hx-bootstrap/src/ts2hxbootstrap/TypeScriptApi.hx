package ts2hxbootstrap;

import genes.ts.Undefinable;

/**
 * Typed view of the script targets used by this compiler-API canary.
 *
 * Why: TypeScript exports a numeric enum, but plain `Int` would let callers
 * mix unrelated compiler options. What: Haxe keeps a distinct abstract type.
 * How: `@:ts.type` restores TypeScript's canonical imported enum in genes-ts;
 * standard Haxe and classic Genes keep the same numeric runtime value.
 */
@:ts.type("import('typescript').ScriptTarget")
abstract ScriptTarget(Int) from Int to Int {}

/** Typed module-kind enum with the same cross-profile projection contract. */
@:ts.type("import('typescript').ModuleKind")
abstract ModuleKind(Int) from Int to Int {}

/** Typed syntax-kind enum used by the cast-free AST walk. */
@:ts.type("import('typescript').SyntaxKind")
abstract SyntaxKind(Int) from Int to Int {}

/** Values used by the canary from TypeScript's exported `ScriptTarget`. */
extern class ScriptTargetValues {
  final ES2022:ScriptTarget;
}

/** Values used by the canary from TypeScript's exported `ModuleKind`. */
extern class ModuleKindValues {
  final NodeNext:ModuleKind;
}

/** Values used by the canary from TypeScript's exported `SyntaxKind`. */
extern class SyntaxKindValues {
  final VariableDeclaration:SyntaxKind;
}

/** Compiler options for the two evidence Programs. */
@:ts.type("import('typescript').CompilerOptions")
typedef CompilerOptions = {
  final strict:Bool;
  final noEmit:Bool;
  final target:ScriptTarget;
  final module:ModuleKind;
}

/** One zero-based location returned by a TypeScript source file. */
@:ts.type("import('typescript').LineAndCharacter")
typedef LineAndCharacter = {
  final line:Int;
  final character:Int;
}

/**
 * Read-only generic array returned by the TypeScript compiler API.
 *
 * Why: TypeScript exposes AST collections as readonly arrays, while Haxe's
 * ordinary `Array<T>` would make genes-ts promise unsupported mutation.
 * What: Haxe callers receive length and indexed reads only.
 * How: `@:ts.type` preserves `ReadonlyArray<T>` in generated TypeScript while
 * standard Haxe and classic Genes use the same runtime array unchanged.
 */
@:forward(length)
@:ts.type("ReadonlyArray<$0>")
abstract TsReadOnlyArray<T>(Array<T>) {
  /** Reads one element without exposing mutation methods. */
  @:arrayAccess public inline function get(index:Int):T {
    return this[index];
  }
}

/** Base AST operations sufficient for a typed, cast-free tree walk. */
@:ts.type("import('typescript').Node")
extern class TsNode {
  final kind:SyntaxKind;
  final pos:Int;
  final end:Int;
  function getChildren(?sourceFile:TsSourceFile):TsReadOnlyArray<TsNode>;
  function getStart(?sourceFile:TsSourceFile, ?includeJsDocComment:Bool):Int;
}

/** Source-file identity and provenance from TypeScript's real AST. */
@:ts.type("import('typescript').SourceFile")
extern class TsSourceFile extends TsNode {
  final fileName:String;
  final text:String;
  function getLineAndCharacterOfPosition(position:Int):LineAndCharacter;
}

/** Opaque strong result of a TypeChecker query. */
@:ts.type("import('typescript').Type")
extern class TsType {}

/** TypeChecker operations exercised by the reduced seam. */
@:ts.type("import('typescript').TypeChecker")
extern class TsTypeChecker {
  function getTypeAtLocation(node:TsNode):TsType;
  function typeToString(type:TsType, ?enclosingDeclaration:TsNode):String;
}

/** Program operations needed to load, validate, and inspect one root. */
@:ts.type("import('typescript').Program")
extern class TsProgram {
  function getRootFileNames():TsReadOnlyArray<String>;
  function getSourceFile(fileName:String):Undefinable<TsSourceFile>;
  function getTypeChecker():TsTypeChecker;
  function getSyntacticDiagnostics(?sourceFile:TsSourceFile):TsReadOnlyArray<TsDiagnostic>;
  function getSemanticDiagnostics(?sourceFile:TsSourceFile):TsReadOnlyArray<TsDiagnostic>;
}

/** Stable diagnostic code and source facts used by the differential. */
@:ts.type("import('typescript').Diagnostic")
extern class TsDiagnostic {
  final code:Int;
  final start:Undefinable<Int>;
  final length:Undefinable<Int>;
  final file:Undefinable<TsSourceFile>;
}

/**
 * Curated typed boundary to the real TypeScript compiler API.
 *
 * Why: a Haxe-authored ts2hx is useful only if it reuses TypeScript's parser,
 * Program, and TypeChecker instead of creating a second compiler front end.
 * What: this extern exposes only the members owned by this feasibility canary;
 * it does not claim the full API is modeled or that a rewrite is planned.
 * How: standard Haxe emits `require("typescript")`; classic Genes and genes-ts
 * project the same `@:jsRequire` fact as a module import. `@:native` avoids
 * Haxe type/value namespace collisions while retaining the host export names.
 */
@:jsRequire("typescript")
extern class TypeScriptApi {
  static final version:String;

  /** Retains the host `ScriptTarget` property without colliding with its Haxe type. */
  @:native("ScriptTarget") static final scriptTarget:ScriptTargetValues;

  /** Retains the host `ModuleKind` property without colliding with its Haxe type. */
  @:native("ModuleKind") static final moduleKind:ModuleKindValues;

  /** Retains the host `SyntaxKind` property without colliding with its Haxe type. */
  @:native("SyntaxKind") static final syntaxKind:SyntaxKindValues;

  static function createProgram(rootNames:Array<String>, options:CompilerOptions):TsProgram;
}
