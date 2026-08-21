package portable;

import js.Node;
import unit.TestNumericSeparator;
import unit.issues.Issue10018;
import unit.issues.Issue10032;
import utest.Assert;

typedef PortableSmokeResult = {
  final profile: String;
  final activeTests: Array<String>;
  final tests: Array<PortableTestResult>;
  final assertions: Int;
  final failures: Int;
}

typedef PortableTestResult = {
  final id: String;
  final assertions: Int;
  final failures: Int;
}

/**
 * Executes the same pinned official Haxe smoke identities in both Genes modes.
 *
 * The TypeScript runner passes `genes.ts`; the classic runner does not. Apart
 * from that profile flag, both compilations use these exact test instances and
 * the same upstream files. The emitted JSON is deliberately small so the
 * outer harness can compare active test identity and outcomes without parsing
 * utest's human-oriented report.
 */
@:access(unit.issues.Issue10032)
@:access(unit.issues.Issue10018)
final class PortableSmokeMain {
  static function main(): Void {
    Assert.reset();
    final activeTests = new Array<String>();
    final tests = new Array<PortableTestResult>();
    final numeric = new TestNumericSeparator();
    run("unit.TestNumericSeparator.test", numeric.test, activeTests, tests);
    run("unit.TestNumericSeparator.testJustBeforeSuffix",
      numeric.testJustBeforeSuffix, activeTests, tests);
    run("unit.TestNumericSeparator.testWithSuffix", numeric.testWithSuffix,
      activeTests, tests);

    final intIterator = PortableSmokeBuilder.unitStdCase();
    run("portable.GeneratedIntIteratorSpec.testIntIterator",
      intIterator.testIntIterator, activeTests, tests);

    #if genes.portable.inject_assertion_failure
    run("portable.HarnessInjection.testAssertionFailure",
      () -> Assert.fail("injected failure"), activeTests, tests);
    #end

    #if !genes.portable.inject_missing_active
    final optionalBeforeRest = new Issue10018();
    run("unit.issues.Issue10018.test", optionalBeforeRest.test, activeTests,
      tests);
    final issue = new Issue10032();
    run("unit.issues.Issue10032.test", issue.test, activeTests, tests);
    #end

    activeTests.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    tests.sort((left,
        right) -> left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    final failures = Assert.failures();
    final result: PortableSmokeResult = {
      profile: #if genes.ts "typescript" #else "classic-esm" #end,
      activeTests: activeTests,
      tests: tests,
      assertions: Assert.assertions(),
      failures: failures.length
    };
    Node.console.log("GENES_PORTABLE_HAXE_RESULT="
      + haxe.Json.stringify(result));
    for (failure in failures) {
      Node.console.error(failure);
    }
    if (failures.length > 0) {
      Node.process.exitCode = 1;
    }
  }

  static function run(id: String, test: () -> Void,
      activeTests: Array<String>, tests: Array<PortableTestResult>): Void {
    final assertionsBefore = Assert.assertions();
    final failuresBefore = Assert.failures().length;
    test();
    final assertions = Assert.assertions() - assertionsBefore;
    final failures = Assert.failures().length - failuresBefore;
    if (assertions == 0) {
      Node.console.error('Selected official smoke test executed no assertion: $id');
      Node.process.exitCode = 1;
      return;
    }
    activeTests.push(id);
    tests.push({
      id: id,
      assertions: assertions,
      failures: failures
    });
  }
}
