export interface Feature {
  readonly name: string;
  readonly score: number;
}

export declare function createFeature(name: string): Feature;
