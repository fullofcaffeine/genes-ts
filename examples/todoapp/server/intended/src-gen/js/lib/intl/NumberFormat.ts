import {Register} from "../../../genes/Register.js"

export type NumberFormatOptions = {
	/**
	The currency to use in currency formatting. Possible values are the ISO 4217 currency codes,
	such as "USD" for the US dollar, "EUR" for the euro, or "CNY" for the Chinese RMB — see the
	[Current currency & funds code list](https://www.currency-iso.org/en/home/tables/table-a1.html).
	There is no default value; if the style is "currency", the currency property must be provided.
	*/
	currency?: string | null,
	/**
	How to display the currency in currency formatting.
	The default is `Symbol`.
	*/
	currencyDisplay?: string | null,
	/**
	The locale matching algorithm to use.
	The default is `BestFit`.
	For information about this option, see the [Intl page](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl#Locale_negotiation).
	*/
	localeMatcher?: string | null,
	/**
	The maximum number of fraction digits to use.
	Possible values are from 0 to 20; the default for plain number formatting is the larger of
	minimumFractionDigits and 3; the default for currency formatting is the larger of minimumFractionDigits
	and the number of minor unit digits provided by the [ISO 4217 currency code list](http://www.currency-iso.org/en/home/tables/table-a1.html)
	(2 if the list doesn't provide that information); the default for percent formatting is the larger of
	minimumFractionDigits and 0.
	*/
	maximumFractionDigits?: number | null,
	/**
	The maximum number of significant digits to use.
	Possible values are from 1 to 21; the default is 21.
	*/
	maximumSignificantDigits?: number | null,
	/**
	The minimum number of fraction digits to use.
	Possible values are from 0 to 20; the default for plain number and percent formatting is 0;
	the default for currency formatting is the number of minor unit digits provided by the
	[ISO 4217 currency code list](http://www.currency-iso.org/en/home/tables/table-a1.html)
	(2 if the list doesn't provide that information).
	*/
	minimumFractionDigits?: number | null,
	/**
	The minimum number of integer digits to use.
	Possible values are from 1 to 21; the default is 1.
	*/
	minimumIntegerDigits?: number | null,
	/**
	The minimum number of significant digits to use.
	Possible values are from 1 to 21; the default is 1.
	*/
	minimumSignificantDigits?: number | null,
	/**
	The formatting style to use.
	The default is `Decimal`.
	*/
	style?: string | null,
	/**
	Whether to use grouping separators, such as thousands separators or thousand/lakh/crore separators.
	The default is `true`.
	*/
	useGrouping?: boolean | null
}

export type NumberFormatResolvedOption = {
	currency: string,
	/**
	The values provided for these properties in the `options` argument or filled in as defaults.
	These properties are only present if `style` is `"currency"`.
	*/
	currencyDisplay: string,
	/**
	The BCP 47 language tag for the locale actually used. If any Unicode extension values were
	requested in the input BCP 47 language tag that led to this locale, the key-value pairs that
	were requested and are supported for this locale are included in `locale`.
	*/
	locale: string,
	/**
	The values provided for these properties in the `options` argument or filled in as defaults.
	These properties are present only if neither m`inimumSignificantDigits` nor `maximumSignificantDigits`
	was provided in the `options` argument.
	*/
	maximumFractionDigits: number,
	/**
	The values provided for these properties in the `options` argument or filled in as defaults.
	These properties are present only if at least one of them was provided in the `options` argument.
	*/
	maximumSignificantDigits: number,
	minimumFractionDigits: number,
	minimumIntegerDigits: number,
	minimumSignificantDigits: number,
	/**
	The value requested using the Unicode extension key `"nu"` or filled in as a default.
	*/
	numberingSystem: string,
	style: string,
	/**
	The values provided for these properties in the `options` argument or filled in as defaults.
	*/
	useGrouping: string
}

export type NumberFormatPart = {
	type: string,
	value: string
}

export type NumberFormatSupportedLocalesOfOptions = {
	/**
	The locale matching algorithm to use.
	The default is `BestFit`.
	*/
	localeMatcher?: string | null
}
