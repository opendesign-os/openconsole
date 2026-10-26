import type { Values } from "../common";
import type { Trace } from "../runtime";
import type { RunnableConfig } from "./config";

export interface Checkpoint {
  readonly id: string;
  readonly threadId: string;
  readonly parentId: string | undefined;
  readonly createdAt: string;
  readonly input: Values;
  readonly values: Values;
  readonly trace: Trace;
}

export interface Checkpointer {
  get(config: RunnableConfig): Promise<Checkpoint | undefined>;
  put(checkpoint: Checkpoint): Promise<void>;
  list(config: RunnableConfig): AsyncIterable<Checkpoint>;
}

export class MemorySaver implements Checkpointer {
  private readonly _threads = new Map<string, Checkpoint[]>();

  public async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    const thread = this._thread(config);
    const id = config.configurable?.checkpoint_id;
    return id === undefined
      ? thread.at(-1)
      : thread.find((checkpoint) => checkpoint.id === id);
  }

  public async put(checkpoint: Checkpoint): Promise<void> {
    const thread = this._threads.get(checkpoint.threadId) ?? [];
    thread.push(checkpoint);
    this._threads.set(checkpoint.threadId, thread);
  }

  public async *list(config: RunnableConfig): AsyncGenerator<Checkpoint> {
    yield* [...this._thread(config)].reverse();
  }

  private _thread(config: RunnableConfig): readonly Checkpoint[] {
    return this._threads.get(config.configurable?.thread_id ?? "") ?? [];
  }
}
