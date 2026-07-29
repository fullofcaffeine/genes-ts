package genes.react.flight.v19;

#if macro
/**
 * Stable semantic category for one rejected React Flight value.
 *
 * Hosts switch on this closed value to preserve their own diagnostics without
 * parsing Genes' explanatory prose.
 */
enum FlightValidationKind {
  UnresolvedType;
  RecursiveValue;
  BroadExternalValue;
  UnsupportedAbstract;
  RawPromise;
  RawSymbol;
  UnsupportedClass;
  OrdinaryFunction;
  RuntimeEnum;
  DynamicValue;
  HostRejected;
}
#end
