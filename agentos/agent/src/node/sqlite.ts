/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import type { Store } from "@openagent/core";

const LAST = "\u{10FFFF}";

export class SqliteStore implements Store {
  private readonly _database: DatabaseSync;

  public constructor(file: string) {
    this._database = new DatabaseSync(file);
    this._database.exec(
      "CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, key))",
    );
  }

  public async get(collection: string, key: string): Promise<unknown> {
    const row = this._database
      .prepare("SELECT value FROM records WHERE collection = ? AND key = ?")
      .get(collection, key) as { readonly value: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.value);
  }

  public async put(
    collection: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    this._database
      .prepare(
        "INSERT INTO records (collection, key, value) VALUES (?, ?, ?) ON CONFLICT (collection, key) DO UPDATE SET value = excluded.value",
      )
      .run(collection, key, JSON.stringify(value));
  }

  public async list(
    collection: string,
    prefix = "",
  ): Promise<Array<readonly [string, unknown]>> {
    const rows = this._database
      .prepare(
        "SELECT key, value FROM records WHERE collection = ? AND key >= ? AND key < ? ORDER BY key",
      )
      .all(collection, prefix, `${prefix}${LAST}`) as Array<{
      readonly key: string;
      readonly value: string;
    }>;
    return rows.map((row) => [row.key, JSON.parse(row.value)] as const);
  }

  public close(): void {
    this._database.close();
  }
}
