import {Register} from "../../genes/Register.js"

export type ThenableStruct<T> = {
	then: <TOut>(onFulfilled: any, onRejected?: ((arg0: any) => any)) => ThenableStruct<TOut>
}

export type PromiseSettleOutcome<T> = {
	reason?: any,
	status: string,
	value?: any
}

