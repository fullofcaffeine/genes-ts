import {Register} from "../../genes/Register"

export type ObserverCallback = {
	handleEvent: (observer: FetchObserver) => void
}
