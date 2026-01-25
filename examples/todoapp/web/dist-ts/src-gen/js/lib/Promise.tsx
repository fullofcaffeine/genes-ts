import {Register} from "../../genes/Register"

export type ThenableStruct<T> = PromiseLike<T>

export type PromiseSettleOutcome<T> = PromiseSettledResult<T>
