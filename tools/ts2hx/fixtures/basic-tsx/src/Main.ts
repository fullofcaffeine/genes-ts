import { Button } from "./components/Button.js";

export function main(): void {
  const el = Button({ label: "ok" });
  console.log(el != null ? "BASIC_TSX_OK" : "BASIC_TSX_FAIL");
}
