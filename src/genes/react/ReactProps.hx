package genes.react;

/**
 * Typed property building blocks for the default React intrinsic provider.
 *
 * Why: Haxe must know what `<input checked>` or `<a href="...">` means before
 * any TypeScript exists. Parsing `@types/react` during every build would make
 * compiler correctness depend on a downstream package and version.
 *
 * What: these closed structures cover a practical, reviewed subset of common
 * HTML, SVG, style, event, and form properties. Missing valid ecosystem fields
 * should be added here or supplied by a custom provider, never accepted through
 * an unsafe catch-all.
 *
 * How: `@:genes.compilerInternal` keeps the schemas available through typing
 * and hides them from public output. `@:genes.semanticOnly` additionally says
 * generated code never names these aliases, so their local TypeScript
 * declarations may also be omitted. `HtmlPropsOf` carries the exact element
 * type into React event callbacks. The anchor and input schemas use focused
 * element facades with the common fields HXX checks today; other tags use the
 * shared `DomElement` boundary. These facades print the canonical browser names
 * in TypeScript without retaining Haxe's much larger DOM declaration graph.
 */
@:genes.compilerInternal
@:genes.semanticOnly
typedef Key = OneOf3<String, Int, Float>;

@:genes.compilerInternal
@:genes.semanticOnly
typedef AttributeValue = OneOf4<String, Int, Float, Bool>;
@:genes.compilerInternal
@:genes.semanticOnly
typedef NumberLike = OneOf3<String, Int, Float>;
@:genes.compilerInternal
@:genes.semanticOnly
typedef FormValue = OneOf3<String, Int, Array<String>>;

/** A deliberately structural subset of React's typed style object. */
@:genes.compilerInternal
@:genes.semanticOnly
typedef CSSProperties = {
  @:optional var color: String;
  @:optional var background: String;
  @:optional var backgroundColor: String;
  @:optional var alignItems: String;
  @:optional var border: String;
  @:optional var borderBottom: String;
  @:optional var borderColor: String;
  @:optional var borderRadius: NumberLike;
  @:optional var display: String;
  @:optional var flex: String;
  @:optional var flexDirection: String;
  @:optional var fontFamily: String;
  @:optional var fontSize: NumberLike;
  @:optional var gap: NumberLike;
  @:optional var gridTemplateColumns: String;
  @:optional var height: NumberLike;
  @:optional var justifyContent: String;
  @:optional var listStyle: String;
  @:optional var margin: NumberLike;
  @:optional var marginTop: NumberLike;
  @:optional var marginRight: NumberLike;
  @:optional var marginBottom: NumberLike;
  @:optional var marginLeft: NumberLike;
  @:optional var maxWidth: NumberLike;
  @:optional var minHeight: NumberLike;
  @:optional var opacity: Float;
  @:optional var overflow: String;
  @:optional var padding: NumberLike;
  @:optional var paddingTop: NumberLike;
  @:optional var paddingRight: NumberLike;
  @:optional var paddingBottom: NumberLike;
  @:optional var paddingLeft: NumberLike;
  @:optional var position: String;
  @:optional var textAlign: String;
  @:optional var textDecoration: String;
  @:optional var transform: String;
  @:optional var transition: String;
  @:optional var width: NumberLike;
  @:optional var zIndex: Int;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef InnerHtml = {
  final __html: String;
}

/** Properties shared by standard HTML elements. */
@:genes.compilerInternal
@:genes.semanticOnly
typedef HtmlProps = HtmlPropsOf<DomElement>;

/** Shared properties with the concrete event-target element preserved. */
@:genes.compilerInternal
@:genes.semanticOnly
typedef HtmlPropsOf<T> = {
  @:optional var children: Node;
  @:optional var key: Key;
  @:optional var id: String;
  @:optional var className: String;
  @:optional var title: String;
  @:optional var role: String;
  @:optional var style: CSSProperties;
  @:optional var tabIndex: Int;
  @:optional var hidden: Bool;
  @:optional var dir: String;
  @:optional var lang: String;
  @:optional var draggable: Bool;
  @:optional var contentEditable: Bool;
  @:optional var spellCheck: Bool;
  @:optional var suppressContentEditableWarning: Bool;
  @:optional var suppressHydrationWarning: Bool;
  @:optional var dangerouslySetInnerHTML: InnerHtml;
  @:optional var onClick: MouseEvent<T>->Void;
  @:optional var onDoubleClick: MouseEvent<T>->Void;
  @:optional var onMouseDown: MouseEvent<T>->Void;
  @:optional var onMouseUp: MouseEvent<T>->Void;
  @:optional var onMouseEnter: MouseEvent<T>->Void;
  @:optional var onMouseLeave: MouseEvent<T>->Void;
  @:optional var onMouseMove: MouseEvent<T>->Void;
  @:optional var onKeyDown: KeyboardEvent<T>->Void;
  @:optional var onKeyUp: KeyboardEvent<T>->Void;
  @:optional var onFocus: FocusEvent<T>->Void;
  @:optional var onBlur: FocusEvent<T>->Void;
  @:optional var onChange: ChangeEvent<T>->Void;
  @:optional var onInput: SyntheticEvent<T>->Void;
  @:optional var onSubmit: SyntheticEvent<T>->Void;
  @:optional var onReset: SyntheticEvent<T>->Void;
  @:optional var onScroll: SyntheticEvent<T>->Void;
  @:optional var onLoad: SyntheticEvent<T>->Void;
  @:optional var onError: SyntheticEvent<T>->Void;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef AnchorProps = {
  > HtmlPropsOf<AnchorElement>,
  @:optional var href: String;
  @:optional var target: String;
  @:optional var download: AttributeValue;
  @:optional var hrefLang: String;
  @:optional var media: String;
  @:optional var ping: String;
  @:optional var referrerPolicy: String;
  @:optional var rel: String;
  @:optional var type: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef ButtonProps = {
  > HtmlProps,
  @:optional var disabled: Bool;
  @:optional var form: String;
  @:optional var formAction: String;
  @:optional var formEncType: String;
  @:optional var formMethod: String;
  @:optional var formNoValidate: Bool;
  @:optional var formTarget: String;
  @:optional var name: String;
  @:optional var type: String;
  @:optional var value: FormValue;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef FormProps = {
  > HtmlProps,
  @:optional var acceptCharset: String;
  @:optional var action: String;
  @:optional var autoComplete: String;
  @:optional var encType: String;
  @:optional var method: String;
  @:optional var name: String;
  @:optional var noValidate: Bool;
  @:optional var target: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef InputProps = {
  > HtmlPropsOf<InputElement>,
  @:optional var accept: String;
  @:optional var alt: String;
  @:optional var autoComplete: String;
  @:optional var autoFocus: Bool;
  @:optional var capture: AttributeValue;
  @:optional var checked: Bool;
  @:optional var defaultChecked: Bool;
  @:optional var defaultValue: FormValue;
  @:optional var disabled: Bool;
  @:optional var form: String;
  @:optional var height: NumberLike;
  @:optional var list: String;
  @:optional var max: NumberLike;
  @:optional var maxLength: Int;
  @:optional var min: NumberLike;
  @:optional var minLength: Int;
  @:optional var multiple: Bool;
  @:optional var name: String;
  @:optional var pattern: String;
  @:optional var placeholder: String;
  @:optional var readOnly: Bool;
  @:optional var required: Bool;
  @:optional var size: Int;
  @:optional var src: String;
  @:optional var step: NumberLike;
  @:optional var type: String;
  @:optional var value: FormValue;
  @:optional var width: NumberLike;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef SelectProps = {
  > HtmlProps,
  @:optional var autoComplete: String;
  @:optional var autoFocus: Bool;
  @:optional var defaultValue: FormValue;
  @:optional var disabled: Bool;
  @:optional var form: String;
  @:optional var multiple: Bool;
  @:optional var name: String;
  @:optional var required: Bool;
  @:optional var size: Int;
  @:optional var value: FormValue;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef TextareaProps = {
  > HtmlProps,
  @:optional var autoComplete: String;
  @:optional var autoFocus: Bool;
  @:optional var cols: Int;
  @:optional var defaultValue: String;
  @:optional var disabled: Bool;
  @:optional var form: String;
  @:optional var maxLength: Int;
  @:optional var minLength: Int;
  @:optional var name: String;
  @:optional var placeholder: String;
  @:optional var readOnly: Bool;
  @:optional var required: Bool;
  @:optional var rows: Int;
  @:optional var value: String;
  @:optional var wrap: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef ImgProps = {
  > HtmlProps,
  @:optional var alt: String;
  @:optional var crossOrigin: String;
  @:optional var decoding: String;
  @:optional var fetchPriority: String;
  @:optional var height: NumberLike;
  @:optional var loading: String;
  @:optional var referrerPolicy: String;
  @:optional var sizes: String;
  @:optional var src: String;
  @:optional var srcSet: String;
  @:optional var useMap: String;
  @:optional var width: NumberLike;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef MediaProps = {
  > HtmlProps,
  @:optional var autoPlay: Bool;
  @:optional var controls: Bool;
  @:optional var crossOrigin: String;
  @:optional var loop: Bool;
  @:optional var muted: Bool;
  @:optional var playsInline: Bool;
  @:optional var preload: String;
  @:optional var src: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef LabelProps = {
  > HtmlProps,
  @:optional var form: String;
  @:optional var htmlFor: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef OptionProps = {
  > HtmlProps,
  @:optional var disabled: Bool;
  @:optional var label: String;
  @:optional var selected: Bool;
  @:optional var value: FormValue;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef TableCellProps = {
  > HtmlProps,
  @:optional var abbr: String;
  @:optional var colSpan: Int;
  @:optional var headers: String;
  @:optional var rowSpan: Int;
  @:optional var scope: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef ScriptProps = {
  > HtmlProps,
  @:optional var async: Bool;
  @:optional var crossOrigin: String;
  @:optional var defer: Bool;
  @:optional var integrity: String;
  @:optional var noModule: Bool;
  @:optional var nonce: String;
  @:optional var referrerPolicy: String;
  @:optional var src: String;
  @:optional var type: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef LinkProps = {
  > HtmlProps,
  @:optional var as: String;
  @:optional var crossOrigin: String;
  @:optional var fetchPriority: String;
  @:optional var href: String;
  @:optional var hrefLang: String;
  @:optional var integrity: String;
  @:optional var media: String;
  @:optional var referrerPolicy: String;
  @:optional var rel: String;
  @:optional var sizes: String;
  @:optional var type: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef MetaProps = {
  > HtmlProps,
  @:optional var charSet: String;
  @:optional var content: String;
  @:optional var httpEquiv: String;
  @:optional var media: String;
  @:optional var name: String;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef IframeProps = {
  > HtmlProps,
  @:optional var allow: String;
  @:optional var allowFullScreen: Bool;
  @:optional var height: NumberLike;
  @:optional var loading: String;
  @:optional var name: String;
  @:optional var referrerPolicy: String;
  @:optional var sandbox: String;
  @:optional var src: String;
  @:optional var srcDoc: String;
  @:optional var width: NumberLike;
}

@:genes.compilerInternal
@:genes.semanticOnly
typedef SvgProps = {
  > HtmlProps,
  @:optional var fill: String;
  @:optional var stroke: String;
  @:optional var strokeWidth: NumberLike;
  @:optional var viewBox: String;
  @:optional var xmlns: String;
  @:optional var x: NumberLike;
  @:optional var y: NumberLike;
  @:optional var cx: NumberLike;
  @:optional var cy: NumberLike;
  @:optional var d: String;
  @:optional var height: NumberLike;
  @:optional var width: NumberLike;
  @:optional var points: String;
  @:optional var preserveAspectRatio: String;
  @:optional var r: NumberLike;
  @:optional var rx: NumberLike;
  @:optional var ry: NumberLike;
  @:optional var transform: String;
}
