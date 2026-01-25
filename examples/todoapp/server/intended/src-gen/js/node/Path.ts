import type {Rest} from "../../haxe/extern/Rest.js"
import {Register} from "../../genes/Register.js"

export type PathModule = {
	basename: (path: string, ext?: string) => string,
	delimiter: string,
	dirname: (path: string) => string,
	extname: (path: string) => string,
	format: (pathObject: PathObject) => string,
	isAbsolute: (path: string) => boolean,
	join: (...paths: Rest<string>) => string,
	normalize: (path: string) => string,
	parse: (pathString: string) => PathObject,
	relative: (from: string, to: string) => string,
	resolve: (...paths: Rest<string>) => string,
	sep: string
}

/**
Path object returned from `Path.parse` and taken by `Path.format`.
*/
export type PathObject = {
	/**
	E.g. "index.html" for "C:\path\dir\index.html"
	*/
	base: string,
	/**
	E.g. "C:\path\dir" for "C:\path\dir\index.html"
	*/
	dir: string,
	/**
	E.g. ".html" for "C:\path\dir\index.html"
	*/
	ext: string,
	/**
	E.g. "index" for "C:\path\dir\index.html"
	*/
	name: string,
	/**
	E.g. "C:\" for "C:\path\dir\index.html"
	*/
	root: string
}
