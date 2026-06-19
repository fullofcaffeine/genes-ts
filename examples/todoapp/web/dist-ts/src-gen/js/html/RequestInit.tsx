import type {ObserverCallback} from "./ObserverCallback"
import {Register} from "../../genes/Register"

export type RequestInit = {
	body?: Blob | ArrayBufferView | ArrayBuffer | FormData | URLSearchParams | string | null,
	cache?: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" | null,
	credentials?: "include" | "omit" | "same-origin" | null,
	headers?: Headers | string[][] | {[key: string]: string} | null,
	integrity?: string | null,
	method?: string | null,
	mode?: "cors" | "navigate" | "no-cors" | "same-origin" | null,
	observe?: ((arg0: FetchObserver) => void) | ObserverCallback | null,
	redirect?: "error" | "follow" | "manual" | null,
	referrer?: string | null,
	referrerPolicy?: "" | "no-referrer" | "no-referrer-when-downgrade" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin" | "unsafe-url" | null,
	signal?: AbortSignal | null
}
