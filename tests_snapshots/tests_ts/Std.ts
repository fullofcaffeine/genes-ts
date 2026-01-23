import {Register} from "./genes/Register.js"

/**
The Std class provides standard methods for manipulating basic types.
*/
export class Std {
	static get __name__(): any {
		return "Std"
	}
	get __class__(): any {
		return Std
	}
}
(Register.global("$hxClasses") as any)["Std"] = Std;


;{
}

