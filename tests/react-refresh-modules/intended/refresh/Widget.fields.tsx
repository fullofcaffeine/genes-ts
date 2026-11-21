import type {JSX} from "react"
import {Register} from "../genes/Register.js"

/**
 * A split module whose class, enum and interface another module
 * (`TypeUser`) uses only as types. `Widget.tsx` re-exports their type side
 * with `export type`, so the type-only import from `Widget.js` still checks.
 */
export type WidgetProps = {
	model: Model
}

/**
 * A public interface beside the components.
 */
export interface Named {
	label(): string;
}
export const Named = function() {};
Named.__isInterface__ = true;

/**
 * A public class beside the components.
 */
export class Model extends Register.inherits() {
	constructor(name: string) {
		super(name);
	}
	declare name: string;
	[Register.new](...args: never[]): void;
	[Register.new](name: string): void {
		this.name = name;
	}
	label(): string {
		return this.name;
	}
	static get __name__(): string {
		return "refresh.Model"
	}
	static get __interfaces__(): Function[] {
		return [Named]
	}
	get __class__(): Function {
		return Model
	}
}
Register.setHxClass("refresh.Model", Model);

Register.seedProtoField(Model, "name");

/**
 * A public enum beside the components.
 */
export declare namespace Kind {
	export const __ename__: string;
	export type Small = {_hx_index: 0, __enum__: "refresh.Kind"}
	export const Small: Small;
	export type Large = {_hx_index: 1, __enum__: "refresh.Kind"}
	export const Large: Large;
	export type __Construct = typeof Small | typeof Large;
	export const __constructs__: __Construct[];
	export type __EmptyConstruct = typeof Small | typeof Large;
	export const __empty_constructs__: __EmptyConstruct[];
}

/**
 * A public enum beside the components.
 */
export type Kind =
	| Kind.Small
	| Kind.Large
export function Kind() {}

Register.setHxEnum("refresh.Kind", Kind);

Object.assign(Kind, {
	__ename__: "refresh.Kind",
	Small: {_hx_name: "Small", _hx_index: 0, __enum__: "refresh.Kind"},
	Large: {_hx_name: "Large", _hx_index: 1, __enum__: "refresh.Kind"}
});

Object.assign(Kind, {
	__constructs__: [Kind.Small, Kind.Large],
	__empty_constructs__: [Kind.Small, Kind.Large]
});
