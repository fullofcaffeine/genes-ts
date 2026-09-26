import type {ChoiceProps, EnumStateProps} from "./out/tsx/src-gen/react_hooks/EnumState.js";

type Mode = NonNullable<EnumStateProps["initial"]>;
const valid: ChoiceProps<Mode> = {value: "document", label: "Document", onChange: () => {}};
// @ts-expect-error The generated enum domain must not admit unrelated strings.
const invalid: ChoiceProps<Mode> = {value: "unrelated", label: "Invalid", onChange: () => {}};
void valid;
void invalid;
