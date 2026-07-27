package genes.react;

/** Exact positional result returned by React `useOptimistic`. */
typedef UseOptimisticResult<State, Action> = Tuple2<State, Dispatch<Action>>;
