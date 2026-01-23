package todo.e2e;

@:jsRequire("@playwright/test", "test")
extern function test(name: String, fn: Dynamic): Void;

@:jsRequire("@playwright/test", "expect")
extern function expect<T>(value: T): Dynamic;
