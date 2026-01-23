import {Register} from "../genes/Register.js"

export class Boot {
	declare static __toStr: Function;
	static __string_rec(o: any, s: string): string {
		if (o == null) {
			return "null";
		};
		if (s.length >= 5) {
			return "<...>";
		};
		let t: string = typeof(o);
		if (t == "function" && (o.__name__ || o.__ename__)) {
			t = "object";
		};
		switch (t) {
			case "function":
				return "<function>";
				break
			case "object":
				if (o.__enum__) {
					let e: any = Register.global("$hxEnums")[o.__enum__];
					let con: any = e.__constructs__[o._hx_index];
					let n: string = con._hx_name;
					if (con.__params__) {
						s = s + "\t";
						return n + "(" + ((function($this) {var $r0
							let _g: string[] = [];
							{
								let _g1: number = 0;
								let _g2: string[] = con.__params__;
								while (true) {
									if (!(_g1 < _g2.length)) {
										break;
									};
									let p: string = _g2[_g1];
									_g1 = _g1 + 1;
									_g.push(Boot.__string_rec(o[p], s));
								};
							};

							$r0 = _g
							return $r0})(this)).join(",") + ")";
					} else {
						return n;
					};
				};
				if (((o) instanceof Array)) {
					let str: string = "[";
					s += "\t";
					let _g: number = 0;
					let _g1: number = o.length;
					while (_g < _g1) {
						let i: number = _g++;
						str += ((i > 0) ? "," : "") + Boot.__string_rec(o[i], s);
					};
					str += "]";
					return str;
				};
				let tostr: any = undefined as any;
				try {
					tostr = o.toString;
				}catch (_g) {
					return "???";
				};
				if (tostr != null && tostr != Object.toString && typeof(tostr) == "function") {
					let s2: string = o.toString();
					if (s2 != "[object Object]") {
						return s2;
					};
				};
				let str: string = "{\n";
				s += "\t";
				let hasp: boolean = o.hasOwnProperty != null;
				let k: string = null as any;
				for( k in o ) {;
				if (hasp && !o.hasOwnProperty(k)) {
					continue;
				};
				if (k == "prototype" || k == "__class__" || k == "__super__" || k == "__interfaces__" || k == "__properties__") {
					continue;
				};
				if (str.length != 2) {
					str += ", \n";
				};
				str += s + k + " : " + Boot.__string_rec(o[k], s);
				};
				s = s.substring(1);
				str += "\n" + s + "}";
				return str;
				break
			case "string":
				return o;
				break
			default:
			return String(o);

		};
	}
	static get __name__(): any {
		return "js.Boot"
	}
	get __class__(): any {
		return Boot
	}
}

;Boot.__toStr = ({}).toString

