import {Register} from "./genes/Register"

export class HxOverrides {
	static cca(s: string, index: number): number | null {
		let x: number | null = s.charCodeAt(index);
		if (x != x) {
			return null;
		};
		return x;
	}
	static substr(s: string, pos: number, len: number | null = null): string {
		if (len == null) {
			len = s.length;
		} else if (Register.unsafeCast<number>(len) < 0) {
			if (pos == 0) {
				len = s.length + len;
			} else {
				return "";
			};
		};
		return s.substr(pos, len);
	}
	static now(): number {
		return Date.now();
	}
	static get __name__(): string {
		return "HxOverrides"
	}
	get __class__(): Function {
		return HxOverrides
	}
}
Register.setHxClass("HxOverrides", HxOverrides);


;((typeof(performance) != "undefined") ? typeof(performance.now) == "function" : false) ? HxOverrides.now = performance.now.bind(performance) : null
