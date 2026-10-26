export interface Store {
  get(collection: string, key: string): Promise<unknown>;
  put(collection: string, key: string, value: unknown): Promise<void>;
  list(
    collection: string,
    prefix?: string,
  ): Promise<Array<readonly [string, unknown]>>;
}
