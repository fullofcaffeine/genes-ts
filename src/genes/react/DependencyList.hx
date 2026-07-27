package genes.react;

/**
 * Read-only-by-surface React dependency list.
 *
 * The semantic `React.deps(...)` macro creates this value directly. Keeping
 * mutation methods off the public Haxe surface protects constant-length Hook
 * dependencies while remaining assignable to React's native array contract.
 */
abstract DependencyList<Value>(Array<Value>) from Array<Value> {}
