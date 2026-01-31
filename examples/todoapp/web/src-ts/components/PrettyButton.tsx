import React from "react";

export type PrettyButtonVariant = "primary" | "danger";

export type PrettyButtonProps = {
  label: string;
  onClick: () => void;
  variant?: PrettyButtonVariant | null;
};

export default function PrettyButton(props: PrettyButtonProps): JSX.Element {
  const { label, onClick, variant } = props;

  const style: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #ddd",
    cursor: "pointer",
    ...(variant === "primary"
      ? { background: "#0ea5e9", color: "white", borderColor: "#0284c7" }
      : variant === "danger"
        ? { background: "#ef4444", color: "white", borderColor: "#dc2626" }
        : { background: "white", color: "#111" })
  };

  return (
    <button type="button" onClick={onClick} style={style}>
      {label}
    </button>
  );
}
