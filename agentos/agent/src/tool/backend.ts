export interface Backend {
  list(): Promise<string[]>;
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
}

export class MemoryBackend implements Backend {
  private readonly _files = new Map<string, string>();

  public async list(): Promise<string[]> {
    return [...this._files.keys()].sort();
  }

  public async read(path: string): Promise<string | undefined> {
    return this._files.get(normalize(path));
  }

  public async write(path: string, content: string): Promise<void> {
    this._files.set(normalize(path), content);
  }
}

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split(/[\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      parts.push(part);
    } else if (parts.pop() === undefined) {
      throw new Error(`${path} is outside the workspace`);
    }
  }
  return `/${parts.join("/")}`;
}
