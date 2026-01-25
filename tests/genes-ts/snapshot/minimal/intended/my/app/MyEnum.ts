import {Register} from "../../genes/Register.js"

export declare namespace MyEnum {

	export const __ename__: string;
	export type A = {_hx_index: 0, __enum__: "my.app.MyEnum"}
	export const A: A;
	export type B = {_hx_index: 1, value: number, __enum__: "my.app.MyEnum"}
	export const B: (value: number) => MyEnum;
	export type __Construct = typeof A | typeof B;
	export const __constructs__: __Construct[];
	export type __EmptyConstruct = typeof A;
	export const __empty_constructs__: __EmptyConstruct[];
}

export type MyEnum =
	| MyEnum.A
	| MyEnum.B
export function MyEnum() {}


Object.assign(MyEnum, {
	__ename__: "my.app.MyEnum",
	A: {_hx_name: "A", _hx_index: 0, __enum__: "my.app.MyEnum"},
	B: Object.assign((value: number) => ({_hx_index: 1, __enum__: "my.app.MyEnum", "value": value}), {_hx_name: "B", __params__: ["value"]})
});

Object.assign(MyEnum, {
	__constructs__: [MyEnum.A, MyEnum.B],
	__empty_constructs__: [MyEnum.A]
});
