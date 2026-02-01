package ts2hx;

import ts2hx.components.Button;

function main(): Void {
  final el = Button({ label: "ok" });
  trace(((el != null) ? "BASIC_TSX_OK" : "BASIC_TSX_FAIL"));
}
