import {Register} from "../../genes/Register.js"

export type ExpressHandler = ((req: ExpressRequest, res: ExpressResponse) => void)

export type ExpressApp = import('express').Application

export type ExpressRequest = import('express').Request

export type ExpressResponse = import('express').Response
