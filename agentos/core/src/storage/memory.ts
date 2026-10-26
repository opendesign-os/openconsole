import type { Store } from "./store";

export class MemoryStore implements Store {
  private readonly _collections = new Map<string, Map<string, unknown>>();

  public async get(collection: string, key: string): Promise<unknown> {
    return this._collections.get(collection)?.get(key);
  }

  public async put(
    collection: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const records = this._collections.get(collection) ?? new Map();
    records.set(key, value);
    this._collections.set(collection, records);
  }

  public async list(
    collection: string,
    prefix = "",
  ): Promise<Array<readonly [string, unknown]>> {
    return [...(this._collections.get(collection) ?? [])]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
