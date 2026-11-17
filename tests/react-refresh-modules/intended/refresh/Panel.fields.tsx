import type {JSX} from "react"
import {LoadLog} from "./LoadLog.js"
import {useState} from "react"
import {Register} from "../genes/Register.js"
import type {UseStateResult} from "../genes/react/UseStateResult.js"

/**
 * Public props of the public component.
 */
export type PanelProps = {
	title: string
}

export type BadgeProps = {
	count: number
}

/**
 * A public enum beside the components.
 */
export declare namespace Tone {
	export const __ename__: string;
	export type Calm = {_hx_index: 0, __enum__: "refresh.Tone"}
	export const Calm: Calm;
	export type Loud = {_hx_index: 1, level: number, __enum__: "refresh.Tone"}
	export const Loud: (level: number) => Tone;
	export type __Construct = typeof Calm | typeof Loud;
	export const __constructs__: __Construct[];
	export type __EmptyConstruct = typeof Calm;
	export const __empty_constructs__: __EmptyConstruct[];
}

/**
 * A public enum beside the components.
 */
export type Tone =
	| Tone.Calm
	| Tone.Loud
export function Tone() {}

Register.setHxEnum("refresh.Tone", Tone);

Object.assign(Tone, {
	__ename__: "refresh.Tone",
	Calm: {_hx_name: "Calm", _hx_index: 0, __enum__: "refresh.Tone"},
	Loud: Object.assign((level: number) => ({_hx_index: 1, __enum__: "refresh.Tone", "level": level}), {_hx_name: "Loud", __params__: ["level"]})
});

Object.assign(Tone, {
	__constructs__: [Tone.Calm, Tone.Loud],
	__empty_constructs__: [Tone.Calm]
});

/**
 * A public class beside the components; its static initializer is logged.
 */
export class Counter {
	declare static loaded: string;
	static next(value: number): number {
		return value + 1;
	}
	static get __name__(): string {
		return "refresh.Counter"
	}
	get __class__(): Function {
		return Counter
	}
}
Register.setHxClass("refresh.Counter", Counter);


Counter.loaded = LoadLog.record("Panel.Counter")
/**
 * A private class that only this module uses.
 */
export class Formatter {
	static label(count: number, tone: Tone): string {
		switch (tone._hx_index) {
			case 0: {
				return "count " + count;
				break;
			}
			case 1: {
				const level: number = tone.level;
				return "COUNT " + count + " (" + level + ")";
				break;
			}
			default: {
				throw "unreachable";
			}
		};
	}
	static get __name__(): string {
		return "refresh._Panel.Formatter"
	}
	get __class__(): Function {
		return Formatter
	}
}
Register.setHxClass("refresh._Panel.Formatter", Formatter);

export function useCount(initial: number): UseStateResult<number> {
	return useState(initial);
}
export class Panel_Fields_ {

	/**
	 * An ordinary module-level function: Genes keeps it on `Panel_Fields_`.
	 */
	static formatCount(count: number): string {
		return Formatter.label(count, Tone.Calm);
	}

	/**
	 * A non-component function that renders a component of the same module.
	 * In the split sibling it reads the component through `Panel_Fields_.Badge`.
	 */
	static badgeFor(count: number): JSX.Element {
		return <Panel_Fields_.Badge count={count} />;
	}

	/**
	 * A Hook beside the components (an exported Hook is not a component).
	 */
	static useCount(initial: number): UseStateResult<number>;
	static useCount(): never {
		throw this;
	}

	/**
	 * The public component. Its body uses every other declaration.
	 */
	static Panel(props: PanelProps): JSX.Element;
	static Panel(): never {
		throw this;
	}

	/**
	 * A private component in the same module.
	 */
	static Badge(props: BadgeProps): JSX.Element;
	static Badge(): never {
		throw this;
	}
	static get __name__(): string {
		return "refresh._Panel.Panel_Fields_"
	}
	get __class__(): Function {
		return Panel_Fields_
	}
}
Panel_Fields_.useCount = useCount;
Register.setHxClass("refresh._Panel.Panel_Fields_", Panel_Fields_);


export const formatCount = Panel_Fields_.formatCount
export const badgeFor = Panel_Fields_.badgeFor
