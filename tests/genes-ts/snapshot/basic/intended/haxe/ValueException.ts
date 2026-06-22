import {Exception} from "./Exception.js"
import {Register} from "../genes/Register.js"

/**
An exception containing arbitrary value.

This class is automatically used for throwing values, which don't extend `haxe.Exception`
or native exception type.
For example:
```haxe
throw "Terrible error";
```
will be compiled to
```haxe
throw new ValueException("Terrible error");
```
*/
export class ValueException extends (Register.inherits(() => Exception, true) as typeof Exception) {
	constructor(value: unknown, previous: Exception | null = null, $native: unknown | null = null) {
		// @ts-ignore
		super(value, previous, $native);
	}
	declare value: unknown;
	[Register.new](...args: never[]): void;
	[Register.new](value: unknown, previous: Exception | null = null, $native: unknown | null = null): void {
		Register.unsafeCast<Function>(super[Register.new]).call(this, String(value), previous, $native);
		this.value = value;
	}

	/**
	Extract an originally thrown value.

	This method must return the same value on subsequent calls.
	Used internally for catching non-native exceptions.
	Do _not_ override unless you know what you are doing.
	*/
	unwrap(): any {
		return this.value;
	}
	static get __name__(): string {
		return "haxe.ValueException"
	}
	static get __super__(): Function {
		return Exception
	}
	get __class__(): Function {
		return ValueException
	}
}
Register.setHxClass("haxe.ValueException", ValueException);

Register.seedProtoField(ValueException, "value");
