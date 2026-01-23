package todo.extern;

// Minimal React externs for hooks used in the todoapp example.

@:jsRequire("react", "useEffect")
extern function useEffect(effect: Void->Void, deps: Array<Dynamic>): Void;

@:jsRequire("react", "useState")
extern function useState<T>(initial: T): Array<Dynamic>;
