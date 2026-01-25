import {Register} from "../../genes/Register.js"

export type ThenableStruct<T> = PromiseLike<T>

export type PromiseSettleOutcome<T> = PromiseSettledResult<T>
