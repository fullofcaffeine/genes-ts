import genes.react.Element;
import genes.react.JSX.*;

private typedef EmptyProps = {}

private typedef ParentProps = {
  final children: Element;
}

private typedef Transcript = {
  final direct: String;
  final named: String;
  final dotted: String;
  final object: String;
  final dottedReads: Array<String>;
  final objectReads: Array<String>;
}

/**
 * Exercises a nested HXX tree whose component values are direct ESM imports.
 *
 * The field-level `@:jsRequire` declarations below do not emit object-property
 * reads. Dependency planning maps each exact Haxe field to one default or
 * named import, so generated JSX reads an ordinary lexical import binding.
 */
class Main {
  static function main(): Void {
    final transcript: Transcript = {
      direct: RuntimeBindings.renderToStaticMarkup(renderTree()),
      named: RuntimeBindings.renderToStaticMarkup(renderNamedTree()),
      dotted: RuntimeBindings.renderToStaticMarkup(renderDottedMemberTree()),
      object: RuntimeBindings.renderToStaticMarkup(renderObjectFieldTree()),
      dottedReads: RuntimeBindings.takeDottedReads(),
      objectReads: RuntimeBindings.takeObjectReads()
    };
    final json = haxe.Json.stringify(transcript);
    // Haxe has no target-neutral typed console writer. Keep this host boundary
    // to one already-serialized String; no untrusted value flows back to Haxe.
    js.Syntax.code("console.log({0})", json);
  }

  static function renderTree(): Element {
    return <DirectComponents.Parent>
      <DirectComponents.Child />
    </DirectComponents.Parent>;
  }

  static function renderNamedTree(): Element {
    return <NamedComponents.NamedParent>
      <NamedComponents.NamedChild />
    </NamedComponents.NamedParent>;
  }

  /** A dotted import suffix is still a JavaScript property read. */
  static function renderDottedMemberTree(): Element {
    return <DottedComponents.Parent>
      <DottedComponents.Child />
    </DottedComponents.Parent>;
  }

  /** A class-level package import exposes fields through an object value. */
  static function renderObjectFieldTree(): Element {
    return <ObjectComponents.Parent>
      <ObjectComponents.Child />
    </ObjectComponents.Parent>;
  }
}

/** Direct package bindings used only by the focused source-JSX fixture. */
private extern class DirectComponents {
  @:jsRequire("./components/Parent.js", "default")
  static function Parent(props: ParentProps): Element;

  @:jsRequire("./components/Child.js", "default")
  static function Child(props: EmptyProps): Element;
}

/** Direct named package bindings exercise the other admitted ESM root. */
private extern class NamedComponents {
  @:jsRequire("./components/Parent.js", "NamedParent")
  static function NamedParent(props: ParentProps): Element;

  @:jsRequire("./components/Child.js", "NamedChild")
  static function NamedChild(props: EmptyProps): Element;
}

/** A dotted named import must retain observable member-access ordering. */
private extern class DottedComponents {
  @:jsRequire("./components/Dotted.js", "Components.Parent")
  static function Parent(props: ParentProps): Element;

  @:jsRequire("./components/Dotted.js", "Components.Child")
  static function Child(props: EmptyProps): Element;
}

/** A default-imported object may expose these fields through getters. */
@:jsRequire("./components/Object.js", "default")
private extern class ObjectComponents {
  static function Parent(props: ParentProps): Element;
  static function Child(props: EmptyProps): Element;
}

/** Direct runtime imports used to render and observe the focused fixture. */
private extern class RuntimeBindings {
  @:jsRequire("react-dom/server", "renderToStaticMarkup")
  static function renderToStaticMarkup(element: Element): String;

  @:jsRequire("./components/Dotted.js", "takeReads")
  static function takeDottedReads(): Array<String>;

  @:jsRequire("./components/Object.js", "takeReads")
  static function takeObjectReads(): Array<String>;
}
