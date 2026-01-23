import {MyEnum} from "./MyEnum.js"
import {MyClass} from "./MyClass.js"
import {Exception} from "../../haxe/Exception.js"
import {Register} from "../../genes/Register.js"

export class Main {
	static main(): void {
		let _: MyClass = new MyClass(1);
		let __: MyEnum = MyEnum.B(2);
		let hxClasses: any = Register.global("$hxClasses");
		let hxEnums: any = Register.global("$hxEnums");
		let classKey: string = "my.app.MyClass";
		let enumKey: string = "my.app.MyEnum";
		if (Object.prototype.hasOwnProperty.call(hxClasses, classKey)) {
			throw Exception.thrown("minimal_runtime should not register classes in $hxClasses");
		};
		if (Object.prototype.hasOwnProperty.call(hxEnums, enumKey)) {
			throw Exception.thrown("minimal_runtime should not register enums in $hxEnums");
		};
		if (Register.global("$hxClasses")[classKey] != null) {
			throw Exception.thrown("minimal_runtime should make Type.resolveClass(...) return null");
		};
		if (Register.global("$hxEnums")[enumKey] != null) {
			throw Exception.thrown("minimal_runtime should make Type.resolveEnum(...) return null");
		};
		console.log("tests_ts_minimal/src/my/app/Main.hx:26:","ok");
	}
	static get __name__(): any {
		return "my.app.Main"
	}
	get __class__(): any {
		return Main
	}
}
