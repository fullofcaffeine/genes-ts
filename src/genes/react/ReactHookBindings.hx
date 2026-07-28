package genes.react;

import genes.react.Effect.EffectCleanup;
import genes.react.ReactRef.RefObject;

/**
 * Internal exact bindings used after semantic macros establish Hook intent.
 *
 * Application code uses `genes.react.React`; these methods exist so generated
 * output keeps direct imports from React without a wrapper runtime.
 */
@:noCompletion
extern class ReactHookBindings {
  @:genes.reactHook
  @:jsRequire("react", "useState")
  static function useStateValue<Value>(initial: Value): State<Value>;

  /**
   * Binding selected when TypeScript needs an explicit state type argument.
   *
   * Haxe has already established `Value`. The call-site witness lets genes-ts
   * preserve it for initial values such as `null` and closed enum abstracts
   * that TypeScript would otherwise widen.
   */
  @:genes.reactHook
  @:ts.explicitTypeArguments
  @:jsRequire("react", "useState")
  static function useStateContextual<Value>(initial: Value): State<Value>;

  @:genes.reactHook
  @:jsRequire("react", "useState")
  static function useStateLazy<Value>(initializer: Void->Value): State<Value>;

  @:genes.reactHook
  @:jsRequire("react", "useMemo")
  static function useMemo<Value, Dependency>(calculate: Void->Value,
    dependencies: DependencyList<Dependency>): Value;

  @:genes.reactHook
  @:jsRequire("react", "useCallback")
  @:overload(function<Argument, Result, Dependency>(callback: Argument->Result,
    dependencies: DependencyList<Dependency>): Argument->Result {})
  @:overload(function<First, Second, Result, Dependency>(callback: (First,
    Second) -> Result,
    dependencies: DependencyList<Dependency>): (First, Second) -> Result {})
  static function useCallback<Result, Dependency>(callback: Void->Result,
    dependencies: DependencyList<Dependency>): Void->Result;

  @:genes.reactHook
  @:jsRequire("react", "useOptimistic")
  static function useOptimistic<State, Action>(passthrough: State,
    reducer: (State, Action) -> State): Optimistic<State, Action>;

  @:jsRequire("react", "createContext")
  static function createContext<Value>(defaultValue: Value): Context<Value>;

  @:genes.reactHook
  @:jsRequire("react", "useContext")
  static function useContext<Value>(context: Context<Value>): Value;

  @:genes.reactHook
  @:jsRequire("react", "useEffect")
  static function useEffectVoid<Dependency>(effect: Void->Void,
    dependencies: DependencyList<Dependency>): Void;

  @:genes.reactHook
  @:jsRequire("react", "useEffect")
  static function useEffectCleanup<Dependency>(effect: Void->EffectCleanup,
    dependencies: DependencyList<Dependency>): Void;

  @:genes.reactHook
  @:ts.explicitTypeArguments
  @:jsRequire("react", "useRef")
  static function useRef<Value>(initial: Null<Value>): RefObject<Value>;
}
