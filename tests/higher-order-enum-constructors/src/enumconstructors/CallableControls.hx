package enumconstructors;

class CallableParent {}

class CallableChild extends CallableParent {
  public function new() {}
}

typedef ParentCallback = CallableParent->CallableParent;
typedef ChildInputCallback = CallableChild->CallableParent;
typedef NullableInputCallback = Null<CallableParent>->CallableParent;
typedef OptionalInputCallback = (?value: CallableParent) -> CallableParent;
