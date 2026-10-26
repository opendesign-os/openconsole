import type { Values } from "../graph";

export interface Cache {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

export interface Memo {
  readonly outputs: Values;
  readonly created: number;
}

export async function fingerprint(
  operator: string,
  input: Values,
): Promise<string> {
  const text = JSON.stringify(input, (_, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${operator}/${hex}`;
}
