package tests.typeonly;

// This record exists only in TS/declaration space. Its values are ordinary JS
// objects, so classic output must never create a runtime module for the alias.
typedef DeclarationOnlyShape = {
  final label: String;
}
