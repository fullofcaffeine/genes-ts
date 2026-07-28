import {Register} from "../Register"

/**
 * Faithful React replacement-or-updater union.
 */
export type SetStateAction<State> = State | ((arg0: State) => State)
