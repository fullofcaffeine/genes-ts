import genes.ts.Imports;

typedef ResourceModule = {
  @:native("default")
  final value:String;
};

class Main {
  static final Prompt:String = Imports.text("./resources/prompt.txt", "PromptText");
  static final Sound:String = Imports.file("./resources/pulse.wav", "PulseFile");

  static function loadParser():js.lib.Promise<ResourceModule> {
    return Imports.dynamicWasm("./resources/parser.wasm");
  }

  static function main() {
    trace(Prompt.length + Sound.length);
    loadParser().then(module -> trace(module.value));
  }
}
