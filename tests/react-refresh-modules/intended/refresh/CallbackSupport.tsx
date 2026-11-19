import type {JSX} from "react"
import {Register} from "../genes/Register.js"

/**
 * Code in another module that calls back into an instance it receives.
 */
export interface CallbackRender {
	render(): JSX.Element;
}
export const CallbackRender = function() {};
CallbackRender.__isInterface__ = true;

export class CallbackRunner {
	static run(target: CallbackRender): JSX.Element {
		return target.render();
	}
	static get __name__(): string {
		return "refresh.CallbackRunner"
	}
	get __class__(): Function {
		return CallbackRunner
	}
}
Register.setHxClass("refresh.CallbackRunner", CallbackRunner);

/**
 * A parent constructor that calls a method that a subclass overrides.
 */
export class CallbackBase extends Register.inherits() {
	constructor() {
		super();
	}
	[Register.new](...args: never[]): void;
	[Register.new](): void {
		this.setup();
	}
	setup(): void {
	}
	static get __name__(): string {
		return "refresh.CallbackBase"
	}
	get __class__(): Function {
		return CallbackBase
	}
}
Register.setHxClass("refresh.CallbackBase", CallbackBase);
