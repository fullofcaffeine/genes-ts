import {Register} from "../genes/Register.js"

/**
 * Records the order in which fixture modules run their static initializers.
 */
export class LoadLog {
	declare static entries: string[];
	static record(name: string): string {
		LoadLog.entries.push(name);
		return name;
	}
	static get __name__(): string {
		return "refresh.LoadLog"
	}
	get __class__(): Function {
		return LoadLog
	}
}
Register.setHxClass("refresh.LoadLog", LoadLog);


LoadLog.entries = []
