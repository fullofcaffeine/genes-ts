import {Register} from "../../genes/Register"

/**
DEPRECATED: use haxe.Rest instead.

A special type that represents "rest" function argument.
Should be used as a type for the last argument of an extern method,
representing that arbitrary number of arguments of given type can be
passed to that method.
@see <https://haxe.org/manual/lf-externs.html>
*/
export type Rest<T> = T[]
