package tests.staticcallable;

/**
 * The second parameter's constraint references the first parameter.
 *
 * A signature that retains only `Value` must still declare `Element`, because
 * TypeScript has to print `Value extends StaticConstraint<Element>`.
 */
class ConstrainedOwner<Element, Value:StaticConstraint<Element>> {}
