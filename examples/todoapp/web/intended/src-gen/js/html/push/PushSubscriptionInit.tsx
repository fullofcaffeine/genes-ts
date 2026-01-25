import {Register} from "../../../genes/Register"

export type PushSubscriptionInit = {
	appServerKey?: ArrayBufferView | ArrayBuffer | null,
	authSecret?: ArrayBuffer | null,
	endpoint: string,
	p256dhKey?: ArrayBuffer | null,
	scope: string
}
