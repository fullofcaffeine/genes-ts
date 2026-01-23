import {Register} from "../../genes/Register.js"

/**
This iterator is used only when `Array<T>` is passed to `Iterable<T>`
*/
export class ArrayIterator<T = any> extends (Register.inherits() as any) {
	constructor(array: T[]);
	constructor(...args: any[]) {
		super(...args);
	}
	declare array: T[];
	declare current: number;
	[Register.new](array?: any): void {
		this.current = 0;
		this.array = array;
	}

	/**
	See `Iterator.hasNext`
	*/
	hasNext(): boolean {
		return this.current < this.array.length;
	}

	/**
	See `Iterator.next`
	*/
	next(): T {
		return this.array[this.current++];
	}
	static get __name__(): any {
		return "haxe.iterators.ArrayIterator"
	}
	get __class__(): any {
		return ArrayIterator
	}
}
ArrayIterator.prototype.array = null as any;

ArrayIterator.prototype.current = null as any;


