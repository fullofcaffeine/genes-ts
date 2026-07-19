package type_roots;

/**
 * Standalone package contract retained because `@:expose` makes it an explicit
 * consumer surface even though no generated implementation names it locally.
 */
@:expose
typedef ExportedContract = {
  final code: String;
}
