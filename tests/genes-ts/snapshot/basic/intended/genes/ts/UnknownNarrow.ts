import {Register} from "../Register.js"

/**
 * Guarded conversions for values acquired as `genes.ts.Unknown`.
 *
 * Haxe can express the runtime checks through low-level JavaScript syntax, but
 * it cannot express TypeScript's control-flow proof that an `unknown` value is
 * now a string, array, or string-indexed record. This class is the small,
 * reusable interop island for those checks. Public methods combine the guard
 * and conversion so callers do not spread unchecked casts through application
 * code.
 */
export class UnknownNarrow {

	/**
	 * Converts only JavaScript strings.
	 */
	static string(value: unknown): string | null {
		return typeof (value) === "string" ? (value) : null;
	}

	/**
	 * Converts only JavaScript booleans.
	 */
	static bool(value: unknown): boolean | null {
		return typeof (value) === "boolean" ? (value) : null;
	}

	/**
	 * Converts finite JavaScript numbers only.
	 */
	static finiteNumber(value: unknown): number | null {
		return typeof (value) === "number" && Number.isFinite(value) ? (value) : null;
	}

	/**
	 * Converts signed 32-bit integer values, the range Haxe `Int` code can rely
	 * on portably.
	 */
	static int32(value: unknown): number | null {
		return typeof (value) === "number" && Number.isInteger(value) && (value) >= -2147483648 && (value) <= 2147483647 ? (value) : null;
	}

	/**
	 * Converts only JavaScript arrays and exposes a read-only unknown view.
	 */
	static array(value: unknown): readonly unknown[] | null {
		return Array.isArray(value) ? (value) : null;
	}

	/**
	 * Converts non-null, non-array JavaScript objects to a record-like view.
	 *
	 * This deliberately does not require a plain prototype. Use a higher-level
	 * decoder when a domain schema needs stricter object semantics.
	 */
	static record(value: unknown): Readonly<Record<string, unknown>> | null {
		return typeof (value) === "object" && (value) !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
	}

	/**
	 * Converts only native JavaScript Error instances.
	 */
	static nativeError(value: unknown): Error | null {
		return (value) instanceof Error ? (value) : null;
	}
	static get __name__(): string {
		return "genes.ts.UnknownNarrow"
	}
	get __class__(): Function {
		return UnknownNarrow
	}
}
Register.setHxClass("genes.ts.UnknownNarrow", UnknownNarrow);
