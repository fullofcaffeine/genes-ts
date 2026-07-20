import genes.ts.TypeArguments;

class CallSiteNotCall {
  static function main(): Void {
    TypeArguments.call("not a call", "closed witness");
  }
}
