export type Iterator<T> = { hasNext(): boolean; next(): T };
export type Iterable<T> = any;
export type KeyValueIterator<K, V> = Iterator<{ key: K; value: V }>;
export type KeyValueIterable<K, V> = { keyValueIterator(): KeyValueIterator<K, V> };
export interface ArrayAccess<T> {}
declare global {
  interface StringConstructor { __name__?: any }
  interface ArrayConstructor { __name__?: any }
}
export const Iterator: any = null;
export const Iterable: any = null;
export const KeyValueIterator: any = null;
export const KeyValueIterable: any = null;
export const ArrayAccess: any = null;

