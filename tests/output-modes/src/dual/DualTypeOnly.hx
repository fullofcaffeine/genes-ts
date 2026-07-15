package dual;

/**
 * Declaration-only record used to prove type reachability does not retain JS.
 *
 * `DualApi.typeOnly` names this class but always returns null. The TS profile
 * needs a source module for type checking and classic declarations need a
 * `.d.ts`; classic runtime DCE must still omit the JavaScript module. A typedef
 * is the honest test vehicle because its values are ordinary object literals
 * and it has no runtime class identity to preserve.
 */
typedef DualTypeOnly = {
  final marker:String;
}
