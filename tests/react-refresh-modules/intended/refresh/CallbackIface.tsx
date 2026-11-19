import type {JSX} from "react"
import {CallbackRender, CallbackRunner} from "./CallbackSupport.js"
import {Register} from "../genes/Register.js"

export type CallbackIfaceProps = {
	n: number
}

/**
 * A static initializer passes a new instance to another module, which calls
 * `render` through an interface. The module stays one file.
 */
export class IfaceImpl extends Register.inherits() {
	constructor() {
		super();
	}
	[Register.new](...args: never[]): void;
	[Register.new](): void {
	}
	render(): JSX.Element {
		return IfaceBadge({"n": 2});
	}
	static get __name__(): string {
		return "refresh.IfaceImpl"
	}
	static get __interfaces__(): Function[] {
		return [CallbackRender]
	}
	get __class__(): Function {
		return IfaceImpl
	}
}
Register.setHxClass("refresh.IfaceImpl", IfaceImpl);

export class IfaceHolder {
	declare static rendered: JSX.Element;
	static get __name__(): string {
		return "refresh.IfaceHolder"
	}
	get __class__(): Function {
		return IfaceHolder
	}
}
Register.setHxClass("refresh.IfaceHolder", IfaceHolder);


IfaceHolder.rendered = CallbackRunner.run(new IfaceImpl())
export function IfaceBadge(props: CallbackIfaceProps): JSX.Element {
	return <i data-iface="">{(props.n == null) ? "null" : "" + props.n}</i>;
}
export class CallbackIface_Fields_ {
	static IfaceBadge(props: CallbackIfaceProps): JSX.Element;
	static IfaceBadge(): never {
		throw this;
	}

	/**
	 * Keeps the module-fields class, so the component has a slot.
	 */
	static ifaceKeep(): number {
		return 1;
	}
	static get __name__(): string {
		return "refresh._CallbackIface.CallbackIface_Fields_"
	}
	get __class__(): Function {
		return CallbackIface_Fields_
	}
}
CallbackIface_Fields_.IfaceBadge = IfaceBadge;
Register.setHxClass("refresh._CallbackIface.CallbackIface_Fields_", CallbackIface_Fields_);


export const ifaceKeep = CallbackIface_Fields_.ifaceKeep
