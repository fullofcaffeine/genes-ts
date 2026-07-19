package genes.react;

/**
 * A React component value whose accepted properties are known to Haxe.
 *
 * Why: React components are values, but Haxe cannot infer from React's
 * TypeScript declarations which generic argument describes JSX properties.
 * Without that link, `<Component label={42} />` could not fail in Haxe.
 *
 * What: `Props` is the exact property object checked for HXX uses of this
 * component value.
 *
 * How: `@:genes.jsxComponentProps(0)` tells the HXX checker that generic
 * argument zero owns the property contract. `@:ts.type` then prints React's
 * standard `ComponentType<Props>` spelling in generated TypeScript. Both
 * annotations are compile-time only and create no runtime wrapper.
 * Alternative wrappers may use the same metadata on their own prop parameter.
 */
@:genes.jsxComponentProps(0)
@:ts.type("import('react').ComponentType<$0>")
extern class ComponentType<Props> {}
