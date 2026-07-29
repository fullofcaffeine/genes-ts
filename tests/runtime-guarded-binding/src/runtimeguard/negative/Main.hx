package runtimeguard.negative;

class Main {
  public static function main(): Void {
    GuardInvalidation.afterDirectWrite();
    GuardInvalidation.afterClosureWrite();
    GuardInvalidation.insideNestedFunction();
    GuardInvalidation.fromDifferentRaw();
    GuardInvalidation.withDifferentType();
  }
}
