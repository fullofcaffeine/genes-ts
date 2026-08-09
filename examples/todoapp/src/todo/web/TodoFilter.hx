package todo.web;

/**
 * The user-selected subset of todos shown on the list page.
 *
 * This is an ordinary Haxe enum so the maintained application exercises a
 * closed domain value through both Genes output profiles. The list page's
 * exhaustive switch is the single owner of what each choice means.
 */
enum TodoFilter {
  All;
  Open;
  Completed;
}
