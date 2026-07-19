package genes.react;

/**
 * React focus event used to type HXX `onFocus` and `onBlur` callbacks.
 *
 * `T` keeps the element that owns the callback. The extern has no runtime
 * value; `@:ts.type` preserves React's canonical `FocusEvent<T>` in output.
 */
@:ts.type("import('react').FocusEvent<$0>")
extern class FocusEvent<T> extends SyntheticEvent<T> {}
