package genes.react;

/** Typed identities used to retain React child types through Haxe lowering. */
class Children {
  /** Keeps a conditional element child typed as `JSX.Element | null`. */
  public static inline function nullable(value: Null<Element>): Null<Element> {
    return value;
  }
}
