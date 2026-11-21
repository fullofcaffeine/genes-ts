import type {JSX} from "react"
import {Register} from "../genes/Register.js"

export class LazyEntry {
	static render(): JSX.Element {
		return <Lazy_Fields_.LazyView />;
	}
	static get __name__(): string {
		return "refresh.LazyEntry"
	}
	get __class__(): Function {
		return LazyEntry
	}
}
Register.setHxClass("refresh.LazyEntry", LazyEntry);

export class Lazy_Fields_ {

	/**
	 * A split module that `Main` loads with `Genes.dynamicImport`. The callback
	 * reads `LazyEntry`, which is in `Lazy.fields.tsx`, so the dynamic import
	 * loads both files and merges their namespaces.
	 */
	static LazyView(): JSX.Element;
	static LazyView(): never {
		throw this;
	}

	/**
	 * An ordinary module-level function: `Lazy_Fields_` holds the component slot.
	 */
	static lazyLabel(): string {
		return "lazy";
	}
	static get __name__(): string {
		return "refresh._Lazy.Lazy_Fields_"
	}
	get __class__(): Function {
		return Lazy_Fields_
	}
}
Register.setHxClass("refresh._Lazy.Lazy_Fields_", Lazy_Fields_);


export const lazyLabel = Lazy_Fields_.lazyLabel
