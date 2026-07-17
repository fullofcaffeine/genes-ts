import {Register} from "../../../genes/Register"
import type {PushSubscriptionKeys} from "./PushSubscriptionKeys"

export type PushSubscriptionJSON = {
	endpoint?: string | null,
	keys?: PushSubscriptionKeys | null
}
