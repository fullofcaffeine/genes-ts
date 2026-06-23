export type Iterator<T> = { hasNext(): boolean; next(): T };
export type HxMapKey = string | number | boolean | symbol | object | null;
export type Iterable<T> = { iterator(): Iterator<T> } | { keys(): Iterator<HxMapKey>; get(k: HxMapKey): T | null } | Array<T>;
export type KeyValueIterator<K, V> = Iterator<{ key: K; value: V }>;
export type KeyValueIterable<K, V> = { keyValueIterator(): KeyValueIterator<K, V> };
export interface ArrayAccess<T> {}
declare global {
  interface StringConstructor { __name__?: string | boolean }
  interface ArrayConstructor { __name__?: string | boolean }
  interface PositionError { readonly code: number; readonly message: string }
  const PositionError: { readonly PERMISSION_DENIED: 1; readonly POSITION_UNAVAILABLE: 2; readonly TIMEOUT: 3; readonly prototype: PositionError };
  interface FetchObserver { readonly state: "requesting" | "responding" | "aborted" | "errored" | "complete"; onstatechange: Function; onrequestprogress: Function; onresponseprogress: Function }
  const FetchObserver: { readonly prototype: FetchObserver };
}
export const Iterator: null = null;
export const Iterable: null = null;
export const KeyValueIterator: null = null;
export const KeyValueIterable: null = null;
export const ArrayAccess: null = null;
