package genes.react;

import genes.react.ReactProps.AnchorProps;
import genes.react.ReactProps.AttributeValue;
import genes.react.ReactProps.ButtonProps;
import genes.react.ReactProps.FormProps;
import genes.react.ReactProps.HtmlProps;
import genes.react.ReactProps.IframeProps;
import genes.react.ReactProps.ImgProps;
import genes.react.ReactProps.InputProps;
import genes.react.ReactProps.LabelProps;
import genes.react.ReactProps.LinkProps;
import genes.react.ReactProps.MediaProps;
import genes.react.ReactProps.MetaProps;
import genes.react.ReactProps.OptionProps;
import genes.react.ReactProps.ScriptProps;
import genes.react.ReactProps.SelectProps;
import genes.react.ReactProps.SvgProps;
import genes.react.ReactProps.TableCellProps;
import genes.react.ReactProps.TextareaProps;

/**
 * Default typed intrinsic provider for React HXX.
 *
 * Why: a lowercase tag such as `<button>` has no Haxe value whose type can be
 * inspected, so the compiler needs one explicit source of property contracts.
 *
 * What: every static field supplies the real Haxe property type for one tag.
 * The built-in list deliberately covers common HTML/SVG and React properties;
 * it is extensible rather than silently accepting unknown attributes.
 *
 * How: `@:genes.jsxIntrinsic("button")` connects an external tag spelling to
 * its field type. `@:genes.jsxAttributePrefix("data-")` admits a typed family
 * of prefixed attributes. `@:genes.jsxOptionalValuesAllowUndefined` mirrors
 * React's DOM declarations, where an optional property may also be supplied
 * explicitly as JavaScript `undefined`; custom providers do not inherit that
 * policy unless they opt in themselves. The metadata changes compile-time HXX
 * validation only; this compiler-internal extern is omitted from generated
 * output. Alternate runtimes may replace or combine providers with
 * `-D genes.react.jsx_intrinsic_providers=some.Provider`.
 */
@:genes.compilerInternal
@:genes.jsxOptionalValuesAllowUndefined
extern class IntrinsicElements {
  @:genes.jsxAttributePrefix("data-")
  public static var dataAttribute: AttributeValue;

  @:genes.jsxAttributePrefix("aria-")
  public static var ariaAttribute: AttributeValue;

  @:genes.jsxIntrinsic("a") public static var tagA: AnchorProps;
  @:genes.jsxIntrinsic("button") public static var tagButton: ButtonProps;
  @:genes.jsxIntrinsic("form") public static var tagForm: FormProps;
  @:genes.jsxIntrinsic("iframe") public static var tagIframe: IframeProps;
  @:genes.jsxIntrinsic("img") public static var tagImg: ImgProps;
  @:genes.jsxIntrinsic("input") public static var tagInput: InputProps;
  @:genes.jsxIntrinsic("label") public static var tagLabel: LabelProps;
  @:genes.jsxIntrinsic("link") public static var tagLink: LinkProps;
  @:genes.jsxIntrinsic("meta") public static var tagMeta: MetaProps;
  @:genes.jsxIntrinsic("option") public static var tagOption: OptionProps;
  @:genes.jsxIntrinsic("script") public static var tagScript: ScriptProps;
  @:genes.jsxIntrinsic("select") public static var tagSelect: SelectProps;
  @:genes.jsxIntrinsic("td") public static var tagTd: TableCellProps;
  @:genes.jsxIntrinsic("th") public static var tagTh: TableCellProps;
  @:genes.jsxIntrinsic("textarea") public static var tagTextarea: TextareaProps;
  @:genes.jsxIntrinsic("audio") public static var tagAudio: MediaProps;
  @:genes.jsxIntrinsic("video") public static var tagVideo: MediaProps;

  @:genes.jsxIntrinsic("abbr") public static var tagAbbr: HtmlProps;
  @:genes.jsxIntrinsic("address") public static var tagAddress: HtmlProps;
  @:genes.jsxIntrinsic("article") public static var tagArticle: HtmlProps;
  @:genes.jsxIntrinsic("aside") public static var tagAside: HtmlProps;
  @:genes.jsxIntrinsic("b") public static var tagB: HtmlProps;
  @:genes.jsxIntrinsic("bdi") public static var tagBdi: HtmlProps;
  @:genes.jsxIntrinsic("bdo") public static var tagBdo: HtmlProps;
  @:genes.jsxIntrinsic("blockquote") public static var tagBlockquote: HtmlProps;
  @:genes.jsxIntrinsic("body") public static var tagBody: HtmlProps;
  @:genes.jsxIntrinsic("br") public static var tagBr: HtmlProps;
  @:genes.jsxIntrinsic("caption") public static var tagCaption: HtmlProps;
  @:genes.jsxIntrinsic("cite") public static var tagCite: HtmlProps;
  @:genes.jsxIntrinsic("code") public static var tagCode: HtmlProps;
  @:genes.jsxIntrinsic("col") public static var tagCol: HtmlProps;
  @:genes.jsxIntrinsic("colgroup") public static var tagColgroup: HtmlProps;
  @:genes.jsxIntrinsic("data") public static var tagData: HtmlProps;
  @:genes.jsxIntrinsic("datalist") public static var tagDatalist: HtmlProps;
  @:genes.jsxIntrinsic("dd") public static var tagDd: HtmlProps;
  @:genes.jsxIntrinsic("del") public static var tagDel: HtmlProps;
  @:genes.jsxIntrinsic("details") public static var tagDetails: HtmlProps;
  @:genes.jsxIntrinsic("dfn") public static var tagDfn: HtmlProps;
  @:genes.jsxIntrinsic("dialog") public static var tagDialog: HtmlProps;
  @:genes.jsxIntrinsic("div") public static var tagDiv: HtmlProps;
  @:genes.jsxIntrinsic("dl") public static var tagDl: HtmlProps;
  @:genes.jsxIntrinsic("dt") public static var tagDt: HtmlProps;
  @:genes.jsxIntrinsic("em") public static var tagEm: HtmlProps;
  @:genes.jsxIntrinsic("embed") public static var tagEmbed: HtmlProps;
  @:genes.jsxIntrinsic("fieldset") public static var tagFieldset: HtmlProps;
  @:genes.jsxIntrinsic("figcaption") public static var tagFigcaption: HtmlProps;
  @:genes.jsxIntrinsic("figure") public static var tagFigure: HtmlProps;
  @:genes.jsxIntrinsic("footer") public static var tagFooter: HtmlProps;
  @:genes.jsxIntrinsic("h1") public static var tagH1: HtmlProps;
  @:genes.jsxIntrinsic("h2") public static var tagH2: HtmlProps;
  @:genes.jsxIntrinsic("h3") public static var tagH3: HtmlProps;
  @:genes.jsxIntrinsic("h4") public static var tagH4: HtmlProps;
  @:genes.jsxIntrinsic("h5") public static var tagH5: HtmlProps;
  @:genes.jsxIntrinsic("h6") public static var tagH6: HtmlProps;
  @:genes.jsxIntrinsic("head") public static var tagHead: HtmlProps;
  @:genes.jsxIntrinsic("header") public static var tagHeader: HtmlProps;
  @:genes.jsxIntrinsic("hgroup") public static var tagHgroup: HtmlProps;
  @:genes.jsxIntrinsic("hr") public static var tagHr: HtmlProps;
  @:genes.jsxIntrinsic("html") public static var tagHtml: HtmlProps;
  @:genes.jsxIntrinsic("i") public static var tagI: HtmlProps;
  @:genes.jsxIntrinsic("ins") public static var tagIns: HtmlProps;
  @:genes.jsxIntrinsic("kbd") public static var tagKbd: HtmlProps;
  @:genes.jsxIntrinsic("legend") public static var tagLegend: HtmlProps;
  @:genes.jsxIntrinsic("li") public static var tagLi: HtmlProps;
  @:genes.jsxIntrinsic("main") public static var tagMain: HtmlProps;
  @:genes.jsxIntrinsic("map") public static var tagMap: HtmlProps;
  @:genes.jsxIntrinsic("mark") public static var tagMark: HtmlProps;
  @:genes.jsxIntrinsic("menu") public static var tagMenu: HtmlProps;
  @:genes.jsxIntrinsic("meter") public static var tagMeter: HtmlProps;
  @:genes.jsxIntrinsic("nav") public static var tagNav: HtmlProps;
  @:genes.jsxIntrinsic("noscript") public static var tagNoscript: HtmlProps;
  @:genes.jsxIntrinsic("object") public static var tagObject: HtmlProps;
  @:genes.jsxIntrinsic("ol") public static var tagOl: HtmlProps;
  @:genes.jsxIntrinsic("optgroup") public static var tagOptgroup: HtmlProps;
  @:genes.jsxIntrinsic("output") public static var tagOutput: HtmlProps;
  @:genes.jsxIntrinsic("p") public static var tagP: HtmlProps;
  @:genes.jsxIntrinsic("picture") public static var tagPicture: HtmlProps;
  @:genes.jsxIntrinsic("pre") public static var tagPre: HtmlProps;
  @:genes.jsxIntrinsic("progress") public static var tagProgress: HtmlProps;
  @:genes.jsxIntrinsic("q") public static var tagQ: HtmlProps;
  @:genes.jsxIntrinsic("rp") public static var tagRp: HtmlProps;
  @:genes.jsxIntrinsic("rt") public static var tagRt: HtmlProps;
  @:genes.jsxIntrinsic("ruby") public static var tagRuby: HtmlProps;
  @:genes.jsxIntrinsic("s") public static var tagS: HtmlProps;
  @:genes.jsxIntrinsic("samp") public static var tagSamp: HtmlProps;
  @:genes.jsxIntrinsic("search") public static var tagSearch: HtmlProps;
  @:genes.jsxIntrinsic("section") public static var tagSection: HtmlProps;
  @:genes.jsxIntrinsic("slot") public static var tagSlot: HtmlProps;
  @:genes.jsxIntrinsic("small") public static var tagSmall: HtmlProps;
  @:genes.jsxIntrinsic("source") public static var tagSource: HtmlProps;
  @:genes.jsxIntrinsic("span") public static var tagSpan: HtmlProps;
  @:genes.jsxIntrinsic("strong") public static var tagStrong: HtmlProps;
  @:genes.jsxIntrinsic("style") public static var tagStyle: HtmlProps;
  @:genes.jsxIntrinsic("sub") public static var tagSub: HtmlProps;
  @:genes.jsxIntrinsic("summary") public static var tagSummary: HtmlProps;
  @:genes.jsxIntrinsic("sup") public static var tagSup: HtmlProps;
  @:genes.jsxIntrinsic("table") public static var tagTable: HtmlProps;
  @:genes.jsxIntrinsic("tbody") public static var tagTbody: HtmlProps;
  @:genes.jsxIntrinsic("template") public static var tagTemplate: HtmlProps;
  @:genes.jsxIntrinsic("tfoot") public static var tagTfoot: HtmlProps;
  @:genes.jsxIntrinsic("thead") public static var tagThead: HtmlProps;
  @:genes.jsxIntrinsic("time") public static var tagTime: HtmlProps;
  @:genes.jsxIntrinsic("title") public static var tagTitle: HtmlProps;
  @:genes.jsxIntrinsic("tr") public static var tagTr: HtmlProps;
  @:genes.jsxIntrinsic("track") public static var tagTrack: HtmlProps;
  @:genes.jsxIntrinsic("u") public static var tagU: HtmlProps;
  @:genes.jsxIntrinsic("ul") public static var tagUl: HtmlProps;
  @:genes.jsxIntrinsic("var") public static var tagVar: HtmlProps;
  @:genes.jsxIntrinsic("wbr") public static var tagWbr: HtmlProps;

  @:genes.jsxIntrinsic("svg") public static var tagSvg: SvgProps;
  @:genes.jsxIntrinsic("circle") public static var tagCircle: SvgProps;
  @:genes.jsxIntrinsic("clipPath") public static var tagClipPath: SvgProps;
  @:genes.jsxIntrinsic("defs") public static var tagDefs: SvgProps;
  @:genes.jsxIntrinsic("ellipse") public static var tagEllipse: SvgProps;
  @:genes.jsxIntrinsic("g") public static var tagG: SvgProps;
  @:genes.jsxIntrinsic("line") public static var tagLine: SvgProps;
  @:genes.jsxIntrinsic("linearGradient") public static var tagLinearGradient: SvgProps;
  @:genes.jsxIntrinsic("mask") public static var tagMask: SvgProps;
  @:genes.jsxIntrinsic("path") public static var tagPath: SvgProps;
  @:genes.jsxIntrinsic("pattern") public static var tagPattern: SvgProps;
  @:genes.jsxIntrinsic("polygon") public static var tagPolygon: SvgProps;
  @:genes.jsxIntrinsic("polyline") public static var tagPolyline: SvgProps;
  @:genes.jsxIntrinsic("radialGradient") public static var tagRadialGradient: SvgProps;
  @:genes.jsxIntrinsic("rect") public static var tagRect: SvgProps;
  @:genes.jsxIntrinsic("stop") public static var tagStop: SvgProps;
  @:genes.jsxIntrinsic("symbol") public static var tagSymbol: SvgProps;
  @:genes.jsxIntrinsic("text") public static var tagText: SvgProps;
  @:genes.jsxIntrinsic("use") public static var tagUse: SvgProps;
}
