package todo.e2e;

import haxe.extern.EitherType;
import js.lib.Promise;
import js.lib.RegExp;

@:ts.type("import('playwright').Response")
typedef Response = {};

typedef WaitForUrlOptions = {
  @:optional var waitUntil: String;
}

@:ts.type("import('@playwright/test').GetByRoleOptions")
typedef GetByRoleOptions = {
  @:optional var name: String;
}

typedef ConsoleMessage = {
  function type(): String;
  function text(): String;
}

@:ts.type("import('@playwright/test').Locator")
typedef Locator = {
  function fill(value: String): Promise<Void>;
  function click(): Promise<Void>;
  function check(): Promise<Void>;
  function count(): Promise<Int>;
  function waitFor(): Promise<Void>;
  function nth(index: Int): Locator;
  function isChecked(): Promise<Bool>;
  function inputValue(): Promise<String>;
}

@:ts.type("import('@playwright/test').Page")
typedef Page = {
  function on<T>(event: String, listener: T->Void): Void;
  function goto(url: String): Promise<Null<Response>>;
  function getByPlaceholder(text: String): Locator;
  function getByRole(role: String, @:optional options: GetByRoleOptions): Locator;
  function getByText(text: String): Locator;
  function waitForURL(url: EitherType<String, RegExp>,
    @:optional options: WaitForUrlOptions): Promise<Void>;
  function url(): String;
  function locator(selector: String): Locator;
}
