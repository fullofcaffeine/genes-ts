package representative;

import js.Node;
import utest.Assert;

typedef RepresentativeResult = {
  final profile: String;
  final activeTests: Array<String>;
  final tests: Array<RepresentativeTestResult>;
  final assertions: Int;
  final failures: Int;
}

typedef RepresentativeTestResult = {
  final id: String;
  final assertions: Int;
  final failures: Int;
}

/** Executes one reviewed official Haxe method in one Genes profile. */
@:access(unit.TestArrowFunctions)
@:access(unit.issues.Issue10007)
final class RepresentativeMain {
  static function main(): Void {
    Assert.reset();
    final activeTests = new Array<String>();
    final tests = new Array<RepresentativeTestResult>();

    #if genes_representative_arrow_functions
    final arrows = new unit.TestArrowFunctions();
    run("unit.TestArrowFunctions.testSyntax", arrows.testSyntax, activeTests,
      tests);
    #elseif genes_representative_evaluation_order
    final evaluationOrder = RepresentativeBuilder.evaluationOrderCase();
    run("unit.spec.TestEvaluationOrder.test", evaluationOrder.test,
      activeTests, tests);
    #elseif genes_representative_map
    final map = RepresentativeBuilder.mapCase();
    run("unit.spec.TestMap.test", map.test, activeTests, tests);
    #elseif genes_representative_string_tools
    final stringTools = RepresentativeBuilder.stringToolsCase();
    run("unit.spec.TestStringTools.test", stringTools.test, activeTests, tests);
    #elseif genes_representative_issue_10007
    final abstractConstructor = new unit.issues.Issue10007();
    run("unit.issues.Issue10007.test", abstractConstructor.test, activeTests,
      tests);
    #else
    #error "No representative case was selected"
    #end

    activeTests.sort(compareStrings);
    tests.sort((left, right) -> compareStrings(left.id, right.id));
    final failures = Assert.failures();
    final result: RepresentativeResult = {
      profile: #if genes.ts "typescript" #else "classic-esm" #end,
      activeTests: activeTests,
      tests: tests,
      assertions: Assert.assertions(),
      failures: failures.length
    };
    Node.console.log("GENES_PORTABLE_HAXE_RESULT="
      + haxe.Json.stringify(result));
    for (failure in failures)
      Node.console.error(failure);
    if (failures.length > 0)
      Node.process.exitCode = 1;
  }

  static function run(id: String, test: () -> Void,
      activeTests: Array<String>,
      tests: Array<RepresentativeTestResult>): Void {
    final assertionsBefore = Assert.assertions();
    final failuresBefore = Assert.failures().length;
    test();
    final assertions = Assert.assertions() - assertionsBefore;
    final failures = Assert.failures().length - failuresBefore;
    if (assertions == 0) {
      Node.console.error('Selected official test executed no assertion: $id');
      Node.process.exitCode = 1;
      return;
    }
    activeTests.push(id);
    tests.push({id: id, assertions: assertions, failures: failures});
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
