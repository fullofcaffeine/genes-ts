/** A generic result whose caller supplies the closed payload domain. */
enum DomainResult<T> {
  Value(value: T);
  Invalid;
}
