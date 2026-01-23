package my.app;

class Greeter {
  final name: String;

  public function new(name: String) {
    this.name = name;
  }

  public function greet(): String {
    return 'Hello, ' + name;
  }
}

