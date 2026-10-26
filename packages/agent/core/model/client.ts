import { createParser } from "eventsource-parser";

import { APIError, type Usage } from "../common";
import { profileOf, type ChatModel, type Profile } from "./profile";
import type { Call, Hooks, Message, Reply, Request } from "./protocol";

export async function complete(
  model: ChatModel,
  request: Request,
  hooks: Hooks = {},
): Promise<Reply> {
  const profile = profileOf(model);
  if ((request.tools?.length ?? 0) > 0 && !profile.tools) {
    throw new APIError(0, `${model.model} does not support tool calling`);
  }
  const url = `${model.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const init = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${model.apiKey}`,
      ...model.defaultHeaders,
    },
    body: JSON.stringify(shape(model, request, profile)),
  };
  const send = model.fetch ?? fetch;
  const retries = model.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const signal = deadline(hooks.signal, model.timeout);
    let response: Response;
    try {
      response = await send(
        url,
        signal === undefined ? init : { ...init, signal },
      );
    } catch (error) {
      if (hooks.signal?.aborted === true || attempt >= retries) throw error;
      await pause(backoff(attempt), hooks.signal);
      continue;
    }
    if (response.ok) return read(response, hooks.delta);
    const detail = await response.text();
    if (attempt >= retries || !retryable(response.status)) {
      throw new APIError(response.status, detail);
    }
    await pause(delay(response, attempt), hooks.signal);
  }
}

function shape(
  model: ChatModel,
  request: Request,
  profile: Profile,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.model,
    messages: request.messages.map((message) =>
      profile.reasoning === "drop" ? plain(message) : message,
    ),
    stream: true,
  };
  if (profile.usage) body["stream_options"] = { include_usage: true };
  if (request.tools !== undefined && request.tools.length > 0) {
    body["tools"] = request.tools.map((signature) => ({
      type: "function",
      function: signature,
    }));
    if (request.toolChoice !== undefined) {
      body["tool_choice"] = request.toolChoice;
    }
  }
  const format = request.responseFormat;
  if (format !== undefined && profile.structured !== "none") {
    body["response_format"] =
      profile.structured === "schema"
        ? { type: "json_schema", json_schema: format }
        : { type: "json_object" };
  }
  const tokens = request.maxTokens ?? model.maxTokens;
  if (tokens !== undefined) body[profile.limit] = tokens;
  const temperature = request.temperature ?? model.temperature;
  if (temperature !== undefined) body["temperature"] = temperature;
  return body;
}

function plain(message: Message): Message {
  if (message.role !== "assistant" || message.reasoning_content === undefined) {
    return message;
  }
  return message.tool_calls === undefined
    ? { role: "assistant", content: message.content }
    : {
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      };
}

function deadline(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
): AbortSignal | undefined {
  if (timeout === undefined) return signal;
  const limit = AbortSignal.timeout(timeout);
  return signal === undefined ? limit : AbortSignal.any([signal, limit]);
}

const retryable = (status: number): boolean =>
  status === 408 || status === 409 || status === 429 || status >= 500;

const backoff = (attempt: number): number =>
  500 * 2 ** attempt + Math.random() * 250;

function delay(response: Response, attempt: number): number {
  const after = Number(response.headers.get("retry-after"));
  return Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt);
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

interface Delta {
  readonly content?: string | null;
  readonly reasoning_content?: string | null;
  readonly tool_calls?: ReadonlyArray<{
    readonly index?: number;
    readonly id?: string;
    readonly function?: { readonly name?: string; readonly arguments?: string };
  }>;
}

interface Chunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: Delta;
    readonly message?: Delta;
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  } | null;
  readonly error?: { readonly message?: string } | null;
}

interface Part {
  id: string;
  name: string;
  arguments: string;
}

class Draft {
  private _content = "";
  private _reasoning = "";
  private _finish = "";
  private _usage: Usage = { input: 0, output: 0 };
  private readonly _parts: Part[] = [];

  public constructor(
    private readonly _delta: ((text: string) => void) | undefined,
  ) {}

  public absorb(chunk: Chunk): void {
    if (chunk.error) {
      throw new APIError(200, chunk.error.message ?? "stream error");
    }
    if (chunk.usage) {
      this._usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
      };
    }
    const choice = chunk.choices?.[0];
    if (choice === undefined) return;
    this._take(choice.delta ?? choice.message ?? {});
    if (choice.finish_reason) this._finish = choice.finish_reason;
  }

  public reply(): Reply {
    const calls = this._parts
      .filter((part) => part !== undefined)
      .map(
        (part, index): Call => ({
          id: part.id === "" ? `call_${index}` : part.id,
          type: "function",
          function: { name: part.name, arguments: part.arguments },
        }),
      );
    return {
      content: this._content,
      reasoning: this._reasoning,
      calls,
      finish: this._finish,
      usage: this._usage,
    };
  }

  private _take(delta: Delta): void {
    if (delta.content) {
      this._content += delta.content;
      this._delta?.(delta.content);
    }
    if (delta.reasoning_content) this._reasoning += delta.reasoning_content;
    delta.tool_calls?.forEach((part, position) => {
      const slot = (this._parts[part.index ?? position] ??= {
        id: "",
        name: "",
        arguments: "",
      });
      if (part.id) slot.id = part.id;
      if (part.function?.name) slot.name += part.function.name;
      if (part.function?.arguments) slot.arguments += part.function.arguments;
    });
  }
}

async function read(
  response: Response,
  delta: ((text: string) => void) | undefined,
): Promise<Reply> {
  const draft = new Draft(delta);
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    draft.absorb((await response.json()) as Chunk);
    return draft.reply();
  }
  if (response.body === null) throw new APIError(response.status, "empty body");
  const parser = createParser({
    onEvent: (event) => {
      if (event.data !== "[DONE]") {
        draft.absorb(JSON.parse(event.data) as Chunk);
      }
    },
  });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(value);
  }
  return draft.reply();
}
