package utest;

/**
 * Minimal marker used by the pinned Haxe 4.3.7 `unit.Test` base class.
 *
 * The full upstream utest runner is intentionally not part of this smoke. Its
 * reporting implementation exercises many legacy dynamic APIs unrelated to
 * the five selected Haxe tests and is not itself a strict-TypeScript corpus.
 * The official test base only requires this marker interface for the selected
 * cases, so the adapter keeps that contract without changing their source.
 */
interface ITest {}
