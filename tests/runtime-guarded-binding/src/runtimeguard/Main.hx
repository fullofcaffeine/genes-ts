package runtimeguard;

class Main {
  public static function main(): Void {
    NodeConsole.log([
      GuardedCatch.recover("enum"),
      GuardedCatch.recover("class"),
      GuardedCatch.recover("plain")
    ].join("|"));
  }
}
