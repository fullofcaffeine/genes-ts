import {Register} from "../../genes/Register"

export type RegistrationOptions = {
	scope?: string | null,
	updateViaCache?: "all" | "imports" | "none" | null
}
