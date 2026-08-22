package genesinventory;

#if macro
import haxe.Json;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import haxe.macro.TypedExprTools;
import sys.io.File;

typedef InventorySource = {
  final file: String;
}

typedef InventoryTest = {
  final id: String;
  final caseId: String;
  final family: String;
  final method: String;
  final source: InventorySource;
}

typedef InventoryOutput = {
  final schemaVersion: Int;
  final profile: String;
  final tests: Array<InventoryTest>;
}

/**
  Reads the fully typed upstream test entry point without executing it.

  Haxe has already resolved conditional compilation and expanded the macros
  that register specification and issue tests when this callback runs. The
  probe therefore records the same case constructors that `unit.TestMain`
  would pass to utest for this exact compiler request.
**/
class InventoryMacro {
  public static function capture(): Void {
    final output = requiredDefine("genes.official_inventory_output");
    final profile = requiredDefine("genes.official_inventory_profile");
    Context.onAfterTyping(types -> {
      final cases = registeredCases(types);
      final tests = new Array<InventoryTest>();
      for (testCase in cases) {
        for (field in testFields(testCase)) {
          final position = source(field.pos);
          tests.push({
            id: testCase.pack.concat([testCase.name])
              .join(".") + "." + field.name,
            caseId: testCase.pack.concat([testCase.name]).join("."),
            family: family(testCase),
            method: field.name,
            source: position
          });
        }
      }
      tests.sort((left, right) -> compareStrings(left.id, right.id));
      final inventory: InventoryOutput = {
        schemaVersion: 1,
        profile: profile,
        tests: tests
      };
      File.saveContent(output, Json.stringify(inventory, null, "  ") + "\n");
    });
  }

  static function registeredCases(types: Array<ModuleType>): Array<ClassType> {
    final byPath = new Map<String, ClassType>();
    function visit(expression: TypedExpr): Void {
      switch expression.expr {
        case TNew(testRef, _):
          final testCase = testRef.get();
          if (implementsITest(testCase)) {
            final path = testCase.pack.concat([testCase.name]).join(".");
            byPath.set(path, testCase);
          }
        case _:
      }
      TypedExprTools.iter(expression, visit);
    }
    for (moduleType in types) {
      switch moduleType {
        case TClassDecl(classRef):
          final cls = classRef.get();
          if (cls.module == "unit.TestMain") {
            for (field in cls.statics.get()) {
              if (field.name == "main") {
                final expression = field.expr();
                if (expression != null) {
                  visit(expression);
                }
              }
            }
          }
        case _:
      }
    }
    final result = [for (testCase in byPath) testCase];
    result.sort((left,
        right) -> compareStrings(left.pack.concat([left.name]).join("."),
        right.pack.concat([right.name]).join(".")));
    return result;
  }

  static function implementsITest(cls: ClassType): Bool {
    for (implemented in cls.interfaces) {
      final type = implemented.t.get();
      if (type.pack.join(".") == "utest" && type.name == "ITest") {
        return true;
      }
      if (implementsITest(type)) {
        return true;
      }
    }
    return
      cls.superClass == null ? false : implementsITest(cls.superClass.t.get());
  }

  static function testFields(cls: ClassType): Array<ClassField> {
    final fields = cls.superClass == null ? new Array<ClassField>() : testFields(cls.superClass.t.get());
    for (field in cls.fields.get()) {
      if (isTestField(field)) {
        fields.push(field);
      }
    }
    fields.sort((left, right) -> compareStrings(left.name, right.name));
    return fields;
  }

  static function isTestField(field: ClassField): Bool {
    if (!isTestName(field.name)) {
      return false;
    }
    return switch field.kind {
      case FMethod(_): true;
      case FVar(_, _): false;
    }
  }

  static function isTestName(name: String): Bool {
    return StringTools.startsWith(name, "test")
      || StringTools.startsWith(name, "spec");
  }

  static function source(position: Position): InventorySource {
    final info = Context.getPosInfos(position);
    final normalized = StringTools.replace(info.file, "\\", "/");
    final unitSuffix = ".unit.hx";
    final suffixAt = normalized.indexOf(unitSuffix);
    final firstEnd = suffixAt < 0 ? -1 : suffixAt + unitSuffix.length;
    final basenameAt = normalized.lastIndexOf("/", firstEnd) + 1;
    final firstBasename = firstEnd < 0 ? "" : normalized.substring(basenameAt,
      firstEnd);
    final file = firstEnd >= 0
      && normalized.substr(firstEnd) == firstBasename ? normalized.substr(0,
        firstEnd) : normalized;
    return {file: file};
  }

  static function family(cls: ClassType): String {
    if (cls.pack.length >= 2 && cls.pack[0] == "unit" && cls.pack[1] == "spec") {
      return "unitstd";
    }
    if (cls.pack.length == 2 && cls.pack[0] == "unit"
      && (cls.pack[1] == "issues" || cls.pack[1] == "hxcpp_issues")) {
      return "issue";
    }
    return "unit";
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  static function requiredDefine(name: String): String {
    final value = Context.definedValue(name);
    if (value == null || value.length == 0) {
      Context.fatalError('Missing required define $name', Context.currentPos());
    }
    return value;
  }
}
#end
