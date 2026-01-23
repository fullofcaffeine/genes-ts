import type {Iterator} from "../StdTypes.js"

export class Register {
	declare static $global: any;
	declare static globals: {[key: string]: any};
	declare static readonly ["new"]: unique symbol;
	declare static readonly init: unique symbol;
	declare static fid: number;
	static global(name: string): any {
		if (Register.globals[name]) {
			return Register.globals[name];
		} else {
			return Register.globals[name] = {};
		};
	}
	static createStatic<T = any>(obj: {
	}, name: string, get: any): void {
		let value: T = null as any;
		Object.defineProperty(obj, name, {"enumerable": true, "get": function () {
			if (get != null) {
				value = get();
				get = null as any;
			};
			return value;
		}, "set": function (v: any) {
			if (get != null) {
				value = get();
				get = null as any;
			};
			value = v;
		}});
	}
	static iterator<T = any>(a: any): (() => Iterator<T>) {
		if (!Array.isArray(a)) {
			return typeof a.iterator === "function" ? a.iterator.bind(a) : a.iterator;
		} else {
			let a1: T[] = a;
			return function () {
				return Register.mkIter(a1);
			};
		};
	}
	static getIterator<T = any>(a: any): Iterator<T> {
		if (!Array.isArray(a)) {
			return a.iterator();
		} else {
			return Register.mkIter(a);
		};
	}
	static mkIter<T = any>(a: T[]): Iterator<T> {
		return new ArrayIterator(a);
	}
	static extend(superClass: any): any {

      function res() {
        // @ts-ignore
        this[Register.new].apply(this, arguments)
      }
      Object.setPrototypeOf(res.prototype, superClass.prototype)
      return res
    ;
	}
	static inherits(resolve?: any, defer?: boolean): any {
		if (defer == null) {
			defer = false;
		};

      function res() {
        // @ts-ignore
        if (defer && resolve && res[Register.init]) res[Register.init]()
        // @ts-ignore
        this[Register.new].apply(this, arguments)
      }
      if (!defer) {
        if (resolve && resolve[Register.init]) {
          defer = true
          // @ts-ignore
          res[Register.init] = () => {
            if (resolve[Register.init]) resolve[Register.init]()
            Object.setPrototypeOf(res.prototype, resolve.prototype)
            // @ts-ignore
            res[Register.init] = undefined
          }
        } else if (resolve) {
          Object.setPrototypeOf(res.prototype, resolve.prototype)
        }
      } else {
        // @ts-ignore
        res[Register.init] = () => {
          const superClass = resolve()
          if (superClass[Register.init]) superClass[Register.init]()
          Object.setPrototypeOf(res.prototype, superClass.prototype)
          // @ts-ignore
          res[Register.init] = undefined
        }
      }
      return res
    ;
	}
	static bind(o: any, m: any): any {
		if (m == null) {
			return null as any;
		};
		if (m.__id__ == null) {
			m.__id__ = Register.fid++;
		};
		let f: any = null as any;
		if (o.hx__closures__ == null) {
			o.hx__closures__ = {};
		} else {
			f = o.hx__closures__[m.__id__];
		};
		if (f == null) {
			f = m.bind(o);
			o.hx__closures__[m.__id__] = f;
		};
		return f;
	}
	static get __name__(): any {
		return "genes.Register"
	}
	get __class__(): any {
		return Register
	}
}

Register.$global = typeof window != "undefined" ? window : typeof global != "undefined" ? global : typeof self != "undefined" ? self : undefined
Register.globals = {}
// @ts-ignore
Register["new"] = Symbol()
// @ts-ignore
Register.init = Symbol()
Register.fid = 0
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
	hasNext(): boolean {
		return this.current < this.array.length;
	}
	next(): T {
		return this.array[this.current++];
	}
	static get __name__(): any {
		return "genes._Register.ArrayIterator"
	}
	get __class__(): any {
		return ArrayIterator
	}
}
(Register.global("$hxClasses") as any)["genes._Register.ArrayIterator"] = ArrayIterator;

ArrayIterator.prototype.array = null as any;

ArrayIterator.prototype.current = null as any;


