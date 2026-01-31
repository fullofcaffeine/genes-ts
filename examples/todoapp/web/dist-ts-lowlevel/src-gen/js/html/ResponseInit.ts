import {Register} from "../../genes/Register"

export type ResponseInit = {
	headers?: Headers | string[][] | {[key: string]: string} | null,
	status?: number | null,
	statusText?: string | null
}
