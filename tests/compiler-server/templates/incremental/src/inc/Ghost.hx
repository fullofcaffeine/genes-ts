package inc;

/**
 * Stage 3, slice S2: named only by the typedef field of `inc.GhostHint`, so
 * dead-code elimination removes it and only the walk creates this module.
 */
class Ghost {
  public function new() {}
}
