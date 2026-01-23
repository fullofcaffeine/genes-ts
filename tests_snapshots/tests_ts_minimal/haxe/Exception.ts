import {ValueException} from "./ValueException.js"
import {Register} from "../genes/Register.js"

/**
Base class for exceptions.

If this class (or derivatives) is used to catch an exception, then
`haxe.CallStack.exceptionStack()` will not return a stack for the exception
caught. Use `haxe.Exception.stack` property instead:
```haxe
try {
throwSomething();
} catch(e:Exception) {
trace(e.stack);
}
```

Custom exceptions should extend this class:
```haxe
class MyException extends haxe.Exception {}
//...
throw new MyException('terrible exception');
```

`haxe.Exception` is also a wildcard type to catch any exception:
```haxe
try {
throw 'Catch me!';
} catch(e:haxe.Exception) {
trace(e.message); // Output: Catch me!
}
```

To rethrow an exception just throw it again.
Haxe will try to rethrow an original native exception whenever possible.
```haxe
try {
var a:Array<Int> = null;
a.push(1); // generates target-specific null-pointer exception
} catch(e:haxe.Exception) {
throw e; // rethrows native exception instead of haxe.Exception
}
```
*/
export class Exception extends (Register.inherits(() => Error, true) as new (...args: any[]) => Error) {
	constructor(message: string, previous?: any, $native?: any);
	constructor(...args: any[]) {
		super(...args);
	}
	declare ["native"]: any;
	declare __skipStack: number;
	declare __nativeException: any;
	declare __previousException: any;
	[Register.new](message?: any, previous?: any, $native?: any): void {
		Error.call(this, message);
		this.message = message;
		this.__previousException = previous;
		this.__nativeException = ($native != null) ? $native : this;
	}
	get_native(): any {
		return this.__nativeException;
	}
	static thrown(value: any): any {
		if (((value) instanceof Exception)) {
			return value.get_native();
		} else if (((value) instanceof Error)) {
			return value;
		} else {
			let e: ValueException = new ValueException(value);
			return e;
		};
	}
	static get __name__(): any {
		return "haxe.Exception"
	}
	static get __super__(): any {
		return Error
	}
	get __class__(): any {
		return Exception
	}
}
Exception.prototype["native"] = null as any;

Exception.prototype.__skipStack = null as any;

Exception.prototype.__nativeException = null as any;

Exception.prototype.__previousException = null as any;


