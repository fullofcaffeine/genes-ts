import {Register} from "./genes/Register.js"

/**
The Std class provides standard methods for manipulating basic types.
*/
export class Std {

	/**
	Converts a `String` to an `Int`.

	Leading whitespaces are ignored.

	`x` may optionally start with a + or - to denote a postive or negative value respectively.

	If the optional sign is followed 0x or 0X, hexadecimal notation is recognized where the following
	digits may contain 0-9 and A-F. Both the prefix and digits are case insensitive.

	Otherwise `x` is read as decimal number with 0-9 being allowed characters. Octal and binary
	notations are not supported.

	Parsing continues until an invalid character is detected, in which case the result up to
	that point is returned. Scientific notation is not supported. That is `Std.parseInt('10e2')` produces `10`.

	If `x` is `null`, the result is `null`.
	If `x` cannot be parsed as integer or is empty, the result is `null`.

	If `x` starts with a hexadecimal prefix which is not followed by at least one valid hexadecimal
	digit, the result is unspecified.
	*/
	static parseInt(x: string): number | null {
		let v: number = parseInt(x);
		if ((isNaN)(v)) {
			return null;
		};
		return v;
	}

	/**
	Return a random integer between 0 included and `x` excluded.

	If `x <= 1`, the result is always 0.
	*/
	static random(x: number): number {
		if (x <= 0) {
			return 0;
		} else {
			return Math.floor(Math.random() * x);
		};
	}
	static get __name__(): string {
		return "Std"
	}
	get __class__(): Function {
		return Std
	}
}
Register.setHxClass("Std", Std);


;{
}
