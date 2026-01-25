import {Register} from "../../genes/Register"

export type FetchHeaders = {[key: string]: string}

export type FetchRequestInit = {
	body?: string | null,
	headers: FetchHeaders,
	method: string
}

export type FetchResponse = {
	json: <T>() => Promise<T>,
	ok: boolean,
	status: number
}

export class Fetch {
	static fetch(url: string, init: FetchRequestInit): Promise<FetchResponse> {
		return fetch(url, init);
	}
	static get __name__(): string {
		return "todo.extern.Fetch"
	}
	get __class__(): Function {
		return Fetch
	}
}
Register.setHxClass("todo.extern.Fetch", Fetch);
