package ts2hx;

function main(): Void {
  trace(ts2hx.extern.Fakepkg.__default("world"));
  trace(ts2hx.extern.Fakepkg.add(1, 2));
  trace(ts2hx.extern.Fakepkg.add(3, 4));
  trace(ts2hx.extern.Fakepkg.PI);
}
