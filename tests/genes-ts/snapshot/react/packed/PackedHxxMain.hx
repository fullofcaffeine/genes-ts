import genes.react.Element;
import genes.react.Node;

typedef PackedCardProps = {
  final title: String;
  @:optional var children: Node;
}

/**
 * Clean consumer compiled only against the extracted Haxelib release ZIP.
 *
 * This catches missing checker/schema files that an in-repository classpath
 * would accidentally hide. The resulting TSX is also checked in every pinned
 * TypeScript lane.
 */
class PackedHxxMain {
  static function Card(props: PackedCardProps): Element {
    return <article className="packed-card"><h1>{props.title}</h1>{props.children}</article>;
  }

  static function main(): Void {
    final view = <Card title="Packaged"><span>typed HXX</span></Card>;
  }
}
