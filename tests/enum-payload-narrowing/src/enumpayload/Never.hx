package enumpayload;

/**
 * Nominal marker with no public constructor.
 *
 * Its important property here is that it is not `Failure`, so the two
 * failure-specialized enum constructors cannot produce the tested application.
 */
class Never {
  private function new() {}
}
