import type {JSX} from "react"
import {Std} from "../Std.js"
import {Register} from "../genes/Register.js"

export type CallbackStringProps = {
	n: number
}

/**
 * `Std.string` calls `toString`, which reads a component while the module
 * loads. The module stays one file.
 */
export class StringLabel extends Register.inherits() {
	constructor() {
		super();
	}
	[Register.new](...args: never[]): void;
	[Register.new](): void {
	}
	toString(): string {
		return Std.string(StringBadge({"n": 9}) != null);
	}
	static get __name__(): string {
		return "refresh.StringLabel"
	}
	get __class__(): Function {
		return StringLabel
	}
}
Register.setHxClass("refresh.StringLabel", StringLabel);

export class StringHolder {
	declare static text: string;
	static get __name__(): string {
		return "refresh.StringHolder"
	}
	get __class__(): Function {
		return StringHolder
	}
}
Register.setHxClass("refresh.StringHolder", StringHolder);


StringHolder.text = Std.string(new StringLabel())
export function StringBadge(props: CallbackStringProps): JSX.Element {
	return <i data-string="">{(props.n == null) ? "null" : "" + props.n}</i>;
}
export class CallbackString_Fields_ {
	static StringBadge(props: CallbackStringProps): JSX.Element;
	static StringBadge(): never {
		throw this;
	}

	/**
	 * Keeps the module-fields class, so the component has a slot.
	 */
	static stringKeep(): number {
		return 1;
	}
	static get __name__(): string {
		return "refresh._CallbackString.CallbackString_Fields_"
	}
	get __class__(): Function {
		return CallbackString_Fields_
	}
}
CallbackString_Fields_.StringBadge = StringBadge;
Register.setHxClass("refresh._CallbackString.CallbackString_Fields_", CallbackString_Fields_);


export const stringKeep = CallbackString_Fields_.stringKeep
