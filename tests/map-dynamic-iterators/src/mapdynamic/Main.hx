package mapdynamic;

typedef ObjectKey = {
  final label: String;
}

/** Same-source runtime proof for Map iteration after a `Dynamic` boundary. */
class Main {
  public static function main(): Void {
    final stringMap = new Map<String, Int>();
    stringMap.set("first", 1);
    stringMap.set("second", 2);

    final intMap = new Map<Int, String>();
    intMap.set(1, "one");
    intMap.set(2, "two");

    final left: ObjectKey = {label: "left"};
    final right: ObjectKey = {label: "right"};
    final objectMap = new Map<ObjectKey, Int>();
    objectMap.set(left, 3);
    objectMap.set(right, 4);

    NodeConsole.log([stringTranscript(stringMap), intTranscript(intMap), objectTranscript(objectMap)].join("|"));
  }

  static function stringTranscript(map: Map<String, Int>): String {
    final boundary: Dynamic = map;
    final values: Iterator<Int> = boundary.iterator();
    final entries: KeyValueIterator<String, Int> = boundary.keyValueIterator();
    return
      'string-values=${collectValues(values)};string-entries=${collectStringEntries(entries)}';
  }

  static function intTranscript(map: Map<Int, String>): String {
    final boundary: Dynamic = map;
    final values: Iterator<String> = boundary.iterator();
    final entries: KeyValueIterator<Int, String> = boundary.keyValueIterator();
    return
      'int-values=${collectValues(values)};int-entries=${collectIntEntries(entries)}';
  }

  static function objectTranscript(map: Map<ObjectKey, Int>): String {
    final boundary: Dynamic = map;
    final values: Iterator<Int> = boundary.iterator();
    final entries: KeyValueIterator<ObjectKey,
      Int> = boundary.keyValueIterator();
    return
      'object-values=${collectValues(values)};object-entries=${collectObjectEntries(entries)}';
  }

  static function collectValues<T>(iterator: Iterator<T>): String {
    final values = [];
    while (iterator.hasNext())
      values.push(Std.string(iterator.next()));
    return values.join(",");
  }

  static function collectStringEntries(iterator: KeyValueIterator<String,
    Int>): String {
    final entries = [];
    while (iterator.hasNext()) {
      final entry = iterator.next();
      entries.push('${entry.key}=${entry.value}');
    }
    return entries.join(",");
  }

  static function collectIntEntries(iterator: KeyValueIterator<Int,
    String>): String {
    final entries = [];
    while (iterator.hasNext()) {
      final entry = iterator.next();
      entries.push('${entry.key}=${entry.value}');
    }
    return entries.join(",");
  }

  static function collectObjectEntries(iterator: KeyValueIterator<ObjectKey,
    Int>): String {
    final entries = [];
    while (iterator.hasNext()) {
      final entry = iterator.next();
      entries.push('${entry.key.label}=${entry.value}');
    }
    return entries.join(",");
  }
}
