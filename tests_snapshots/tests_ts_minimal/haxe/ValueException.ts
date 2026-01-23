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
export class ValueException extends (Register.inherits(() => Exception, true) as new (...args: any[]) => Exception) {
	constructor(value: any, previous?: any, $native?: any);
	constructor(...args: any[]) {
		super(...args);
	}
	declare value: any;
	[Register.new](value?: any, previous?: any, $native?: any): void {
		super[Register.new](String(value), previous, $native);
		this.value = value;
	}
	static get __name__(): any {
		return "haxe.ValueException"
	}
	static get __super__(): any {
		return Exception
	}
	get __class__(): any {
		return ValueException
	}
}
ValueException.prototype.value = null as any;
