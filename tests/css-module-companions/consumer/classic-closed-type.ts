import { exportedStyles } from "../out/classic-dts/css_module_companions/Main.js";

const styles = exportedStyles();

styles.card;
styles["error-state"];

// @ts-expect-error The classic declaration must not accept arbitrary keys.
styles.missing;
