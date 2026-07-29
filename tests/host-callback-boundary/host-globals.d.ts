declare class TypedHostCallbacks {
  onready: (value: string) => void;
}

declare class OpaqueHostCallbacks {
  onready: (value: string) => void;
}

declare class OverriddenHostCallbacks {
  onnumber: (value: number) => void;
  ontext: (value: string) => void;
}
