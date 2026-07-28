import {Register} from "../Register"
import type {Dispatch} from "./Dispatch"
import type {SetStateAction} from "./SetStateAction"

/**
 * Exact positional result returned by React `useState`.
 */
export type UseStateResult<State> = [State, Dispatch<SetStateAction<State>>]
