package todo.web;

import genes.react.Element;
import haxe.extern.EitherType;

typedef ReactElement = Element;

// In this app we use text nodes and conditional `null` in a few spots.
typedef ReactChild = Null<EitherType<ReactElement, String>>;
typedef ReactComponent = Void->ReactElement;
typedef ReactComponent1<P> = P->ReactElement;

typedef ChangeEvent = {
  final target: {
    final value: String;
  };
}
