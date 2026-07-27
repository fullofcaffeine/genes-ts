package genes.react;

/** Exact positional result returned by React `useState`. */
typedef UseStateResult<State> = Tuple2<State, Dispatch<SetStateAction<State>>>;
