import type {ObserverCallback} from "./ObserverCallback"
import {Register} from "../../genes/Register"

export type RequestInit = {
	body?: Blob | ArrayBufferView | ArrayBuffer | FormData | URLSearchParams | string | null,
	cache?: string | null,
	credentials?: string | null,
	headers?: Headers | string[][] | {[key: string]: string} | null,
	integrity?: string | null,
	method?: string | null,
	mode?: string | null,
	observe?: ((arg0: FetchObserver) => void) | ObserverCallback | null,
	redirect?: string | null,
	referrer?: string | null,
	referrerPolicy?: string | null,
	signal?: AbortSignal | null
}
