import {Register} from "../../../genes/Register"

export type OpenDBOptions = {
	storage?: "default" | "persistent" | "temporary" | null,
	version?: number | null
}
