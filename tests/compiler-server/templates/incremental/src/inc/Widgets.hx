package inc;

/** The JSX checker reads the props type by name during generation. */
@:jsRequire("./widget-status.js", "WidgetStatus")
@:genes.jsxComponentProps("inc.WidgetProps.Props")
extern class WidgetStatus {}
