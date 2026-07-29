package enumconstructors;

/** Generic enum whose constructors each omit one owner type parameter. */
enum Choice<A, B> {
  Left(value: A);
  Right(value: B);
}
