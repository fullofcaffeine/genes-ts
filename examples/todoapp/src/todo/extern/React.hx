package todo.extern;

// Minimal React externs for hooks used in the todoapp example.

import todo.web.ReactTypes.ReactDeps;
import todo.web.ReactTypes.State;

@:jsRequire("react", "useEffect")
extern function useEffect(effect: Void->Void, deps: ReactDeps): Void;

@:jsRequire("react", "useState")
extern function useState<T>(initial: T): State<T>;
