import {Register} from "../Register"

/**
 * Faithful React dispatcher function.
 */
export type Dispatch<Action> = ((arg0: Action) => void)
