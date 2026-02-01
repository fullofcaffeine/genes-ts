package ts2hx.domain;

import ts2hx.domain.Todo;

typedef Action = haxe.extern.EitherType<haxe.extern.EitherType<{ var type: Dynamic; var title: String; }, { var type: Dynamic; var id: String; }>, { var type: Dynamic; var todos: Array<Todo>; }>;
