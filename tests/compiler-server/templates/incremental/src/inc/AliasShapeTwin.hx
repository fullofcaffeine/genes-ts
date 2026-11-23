package inc;

/**
 * A structure with the same shape as `inc.AliasShape`. The shadow gate
 * points an import alias at it and back (genes-44h0), so the alias keeps its
 * name and shape while its target changes.
 */
typedef AliasShapeTwin = {
  final id: Int;
}
