package tests;

import genes.ts.Imports;

/**
 * An inline function that `TestImportHelper` inlines (genes-f8vc.14.43).
 *
 * Each module makes its own `genes.ts.Imports` holder for an import, so the
 * module that inlines `join()` and also imports `join` itself holds two
 * holders of one import. Genes must still print one import line for them.
 */
class ImportHelperShared {
  /** Returns Node's `path.join`, imported by this module's own holder. */
  public static inline function join(): (a: String, b: String) -> String {
    return Imports.namedImport("path", "join");
  }
}
