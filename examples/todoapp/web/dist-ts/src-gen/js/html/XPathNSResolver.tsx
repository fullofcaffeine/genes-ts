import {Register} from "../../genes/Register"

export type XPathNSResolver = {
	lookupNamespaceURI: (prefix: string) => string
}
