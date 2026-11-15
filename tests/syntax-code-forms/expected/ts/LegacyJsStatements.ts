import {Exception} from "../haxe/Exception.js"
import {Std} from "../Std.js"
import {Register} from "../genes/Register.js"

/**
 * `__js__` values that Genes does NOT print: Haxe's own printer still does.
 *
 * Why: Haxe rewrites ordinary code so that a statement never stands where a
 * value is expected. It does not rewrite the arguments of `__js__`. A value
 * can therefore be a `throw`, a loop, a `switch`, a block, a `try`, or a
 * function whose body was never rewritten. Genes' value printer is not built
 * for these, so `ExprEmitter.isPlainRawCodeValue` sends the whole call to
 * Haxe's printer, exactly as before Genes printed `__js__`.
 *
 * Each function below holds one such kind. `yarn test:syntax-code-forms`
 * checks that this module still equals the text that Haxe's printer produced
 * (`expected/`), that the printer-use report names this module, and that
 * every function runs.
 *
 * `untyped` is required because Haxe exposes `__js__` only to untyped code.
 */
export class LegacyJsStatements {

	/**
	 * Throws for an empty text; returns its length otherwise.
	 */
	static measure(text: string): number {
		if (text == "") {
			throw Exception.thrown("empty");
		};
		return text.length;
	}

	/**
	 * Throws a text for 1, a number for 2, and returns 7 otherwise.
	 */
	static boom(kind: number): number {
		if (kind == 1) {
			throw Exception.thrown("text");
		};
		if (kind == 2) {
			throw Exception.thrown(42);
		};
		return 7;
	}
	static plainThrow(text: string): number {
		return (function($this) {
	var $r;
	throw Exception.thrown(text);
	return $r;
}(this)) + 1;
	}
	static branchThrow(text: string): number {
		return (text.length > 1 ? text.length : (function($this) {
	var $r;
	throw Exception.thrown("short");
	return $r;
}(this))) + 1;
	}
	static switchThrow(choice: number): number {
		return (function($this) {
	var $r;
	switch(choice) {
	case 1:
		$r = 10;
		break;
	case 2:
		$r = 20;
		break;
	default:
		$r = (function($this) {
			var $r;
			throw Exception.thrown("bad");
			return $r;
		}($this));
	}
	return $r;
}(this)) + 1;
	}
	static coalesceThrow(value: number | null): number {
		return (function($this) {
	var $r;
	let tmp = value;
	$r = tmp != null ? tmp : (function($this) {
		var $r;
		throw Exception.thrown("missing");
		return $r;
	}($this));
	return $r;
}(this)) + 1;
	}
	static anyCatch(text: string): number {
		return (function($this) {
	var $r;
	try {
		$r = LegacyJsStatements.measure(text);
	} catch( _g ) {
		$r = 40;
	}
	return $r;
}(this)) + 1;
	}
	static typedCatch(kind: number): number {
		return (function($this) {
	var $r;
	try {
		$r = LegacyJsStatements.boom(kind);
	} catch( _g ) {
		$r = (function($this) {
			var $r;
			let _g1 = Exception.caught(_g);
			let _g2 = _g1.unwrap();
			$r = typeof(_g2) == "string" ? (function($this) {
				var $r;
				let error = _g2;
				$r = error.length;
				return $r;
			}($this)) : (function($this) {
				var $r;
				throw _g;
				return $r;
			}($this));
			return $r;
		}($this));
	}
	return $r;
}(this)) + 1;
	}
	static whileLoop(limit: number): number {
		let index: number = 0;
		void (function($this) {
	var $r;
	while(true) {
		if(!(index < limit)) {
			break;
		}
		index = index + 1;
		index - 1;
	}
	return $r;
}(this));
		return index;
	}
	static doWhileLoop(limit: number): number {
		let index: number = 0;
		void (function($this) {
	var $r;
	while(true) {
		index = index + 1;
		index - 1;
		if(!(index < limit)) {
			break;
		}
	}
	return $r;
}(this));
		return index;
	}
	static forLoop(items: number[]): number {
		let total: number = 0;
		void (function($this) {
	var $r;
	let _g = 0;
	$r = (function($this) {
		var $r;
		while(true) {
			if(!(_g < items.length)) {
				break;
			}
			let item = items[_g];
			_g = _g + 1;
			total = total + item;
		}
		return $r;
	}($this));
	return $r;
}(this));
		return total;
	}
	static blockValue(input: number): number {
		return (function($this) {
	var $r;
	let doubled = input * 2;
	$r = doubled;
	return $r;
}(this)) + 1;
	}
	static varValue(input: number): number {
		void (function($this) {
	var $r;
	let unused = input;
	return $r;
}(this));
		return input + 1;
	}
	static functionValue(input: number): number {
		const viaFunction: number = function() {
	return input + 1;
}();
		const viaArrow: number = function() {
	return input + 2;
}();
		return viaFunction * 10 + viaArrow;
	}
	static attempt(call: (() => number)): string {
		try {
			return Std.string(call());
		}catch (_g_3) {
			return "thrown";
		};
	}
	static run(): string[] {
		return [LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.plainThrow("x");
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.branchThrow("long");
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.branchThrow("s");
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.switchThrow(2);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.switchThrow(3);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.coalesceThrow(5);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.coalesceThrow(null);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.anyCatch("six!");
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.anyCatch("");
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.typedCatch(0);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.typedCatch(1);
		}), LegacyJsStatements.attempt(function () {
			return LegacyJsStatements.typedCatch(2);
		}), Std.string(LegacyJsStatements.whileLoop(3)), Std.string(LegacyJsStatements.doWhileLoop(3)), Std.string(LegacyJsStatements.forLoop([1, 2, 3])), Std.string(LegacyJsStatements.blockValue(4)), Std.string(LegacyJsStatements.varValue(4)), Std.string(LegacyJsStatements.functionValue(1))];
	}
	static get __name__(): string {
		return "syntaxcodeforms.LegacyJsStatements"
	}
	get __class__(): Function {
		return LegacyJsStatements
	}
}
Register.setHxClass("syntaxcodeforms.LegacyJsStatements", LegacyJsStatements);

//# sourceMappingURL=LegacyJsStatements.ts.map
