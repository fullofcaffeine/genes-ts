package ts2hxbootstrap;

import ts2hxbootstrap.TypeScriptApi.CompilerOptions;
import ts2hxbootstrap.TypeScriptApi.SyntaxKind;
import ts2hxbootstrap.TypeScriptApi.TsNode;
import ts2hxbootstrap.TypeScriptApi.TsReadOnlyArray;
import ts2hxbootstrap.TypeScriptApi.TsSourceFile;

/**
 * Runs the smallest honest Haxe-to-TypeScript-API feasibility proof.
 *
 * Why: compiling a translator in Haxe is only plausible if ordinary typed Haxe
 * can obtain authoritative Program, TypeChecker, diagnostic, and source facts.
 * What: one valid Program proves a type query and one invalid Program proves a
 * stable diagnostic code and source position.
 * How: the same source runs through standard Haxe, classic Genes, and genes-ts.
 * The test runner compares all three with a direct TypeScript implementation.
 */
class Main {
  static final sourcePath = "tests/ts2hx-bootstrap/input.ts";
  static final invalidSourcePath = "tests/ts2hx-bootstrap/invalid.ts";

  static function findFirst(node:TsNode, source:TsSourceFile,
      wanted:SyntaxKind):Null<TsNode> {
    if (node.kind == wanted) return node;
    final children:TsReadOnlyArray<TsNode> = node.getChildren(source);
    for (index in 0...children.length) {
      final child = children[index];
      final found = findFirst(child, source, wanted);
      if (found != null) return found;
    }
    return null;
  }

  static function options():CompilerOptions {
    return {
      strict: true,
      noEmit: true,
      target: TypeScriptApi.scriptTarget.ES2022,
      module: TypeScriptApi.moduleKind.NodeNext
    };
  }

  static function main():Void {
    final program = TypeScriptApi.createProgram([sourcePath], options());
    final source = program.getSourceFile(sourcePath).orNull();
    if (source == null)
      throw new haxe.Exception("TypeScript Program lost its valid root source file.");
    final declaration = findFirst(
      source,
      source,
      TypeScriptApi.syntaxKind.VariableDeclaration
    );
    if (declaration == null)
      throw new haxe.Exception("Typed AST walk lost the variable declaration.");
    final checker = program.getTypeChecker();
    final renderedType = checker.typeToString(checker.getTypeAtLocation(declaration));
    final location = source.getLineAndCharacterOfPosition(declaration.getStart(source));
    final diagnosticCount = program.getSyntacticDiagnostics(source).length
      + program.getSemanticDiagnostics(source).length;

    final invalidProgram = TypeScriptApi.createProgram([invalidSourcePath], options());
    final invalidSource = invalidProgram.getSourceFile(invalidSourcePath).orNull();
    if (invalidSource == null)
      throw new haxe.Exception("TypeScript Program lost its invalid root source file.");
    final diagnostics = invalidProgram.getSemanticDiagnostics(invalidSource);
    if (diagnostics.length != 1)
      throw new haxe.Exception("Expected exactly one semantic diagnostic.");
    final diagnostic = diagnostics[0];
    final diagnosticStart = diagnostic.start.orNull();
    final diagnosticFile = diagnostic.file.orNull();
    if (diagnosticStart == null || diagnosticFile == null)
      throw new haxe.Exception("Semantic diagnostic lost its source position.");
    final diagnosticLocation = diagnosticFile.getLineAndCharacterOfPosition(diagnosticStart);

    final result = [
      "version=" + TypeScriptApi.version,
      "roots=" + program.getRootFileNames().length,
      "type=" + renderedType,
      "line=" + (location.line + 1),
      "column=" + (location.character + 1),
      "diagnostics=" + diagnosticCount,
      "error=" + diagnostic.code,
      "errorLine=" + (diagnosticLocation.line + 1),
      "errorColumn=" + (diagnosticLocation.character + 1)
    ].join(";");
    if (renderedType != "number"
      || location.line != 1
      || location.character != 13
      || diagnosticCount != 0
      || diagnostic.code != 2322
      || diagnosticLocation.line != 1
      || diagnosticLocation.character != 13) {
      throw new haxe.Exception("Unexpected TypeScript API result: " + result);
    }
    trace("TS2HX_HAXE_BOOTSTRAP_OK:" + result);
  }
}
