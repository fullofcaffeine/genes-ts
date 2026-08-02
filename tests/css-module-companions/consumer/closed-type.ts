import type { CardStyles } from "../out/dts/css_module_companions/CardStyles.js";

declare const styles: CardStyles;

styles.card;
styles["error-state"];
styles["__element"];
styles["_hx_button"];

// @ts-expect-error The generated public type must not accept arbitrary keys.
styles.missing;
