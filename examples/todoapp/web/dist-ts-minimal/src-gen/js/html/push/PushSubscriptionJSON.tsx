import type {PushSubscriptionKeys} from "./PushSubscriptionKeys"
import {Register} from "../../../genes/Register"

export type PushSubscriptionJSON = {
	endpoint?: string | null,
	keys?: PushSubscriptionKeys | null
}
