import type {JSX} from "react"
import {CallbackBase} from "./CallbackSupport.js"
import {Register} from "../genes/Register.js"

export type CallbackSuperProps = {
	n: number
}

/**
 * The parent constructor in another module calls the override `setup`,
 * which reads a component while the module loads. The module stays one file.
 */
export class SuperChild extends (Register.inherits(CallbackBase) as typeof CallbackBase) {
	constructor() {
		// @ts-ignore
		super();
	}
	declare element: JSX.Element | null;
	[Register.new](...args: never[]): void;
	[Register.new](): void {
		this.element = null;
		Register.unsafeCast<Function>(super[Register.new]).call(this);
	}
	setup(): void {
		this.element = SuperBadge({"n": 3});
	}
	static get __name__(): string {
		return "refresh.SuperChild"
	}
	static get __super__(): Function {
		return CallbackBase
	}
	get __class__(): Function {
		return SuperChild
	}
}
Register.setHxClass("refresh.SuperChild", SuperChild);

Register.seedProtoField(SuperChild, "element");

export class SuperHolder {
	declare static child: SuperChild;
	static get __name__(): string {
		return "refresh.SuperHolder"
	}
	get __class__(): Function {
		return SuperHolder
	}
}
Register.setHxClass("refresh.SuperHolder", SuperHolder);


SuperHolder.child = new SuperChild()
export function SuperBadge(props: CallbackSuperProps): JSX.Element {
	return <i data-super="">{(props.n == null) ? "null" : "" + props.n}</i>;
}
export class CallbackSuper_Fields_ {
	static SuperBadge(props: CallbackSuperProps): JSX.Element;
	static SuperBadge(): never {
		throw this;
	}

	/**
	 * Keeps the module-fields class, so the component has a slot.
	 */
	static superKeep(): number {
		return 1;
	}
	static get __name__(): string {
		return "refresh._CallbackSuper.CallbackSuper_Fields_"
	}
	get __class__(): Function {
		return CallbackSuper_Fields_
	}
}
CallbackSuper_Fields_.SuperBadge = SuperBadge;
Register.setHxClass("refresh._CallbackSuper.CallbackSuper_Fields_", CallbackSuper_Fields_);


export const superKeep = CallbackSuper_Fields_.superKeep
