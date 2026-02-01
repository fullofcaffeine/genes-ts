package ts2hx.lib;

function makeId(prefix: String): String {
  return ((prefix + "-") + Math.floor((Math.random() * 1000)));
}
final __default = makeId;
