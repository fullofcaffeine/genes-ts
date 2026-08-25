package lexicalbinding;

/** Constructor and constant forms exercise both enum runtime shapes. */
enum StructuralEnum {
  Empty;
  WithValue(value: Int);
}

function retainStructuralEnumCases(): Void {
  trace(StructuralEnum.Empty);
  trace(StructuralEnum.WithValue(2));
}
