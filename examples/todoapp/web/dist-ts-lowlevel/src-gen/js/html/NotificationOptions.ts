import {Register} from "../../genes/Register"

export type NotificationOptions = {
	body?: string | null,
	data?: any | null,
	dir?: "auto" | "ltr" | "rtl" | null,
	icon?: string | null,
	lang?: string | null,
	requireInteraction?: boolean | null,
	tag?: string | null
}
