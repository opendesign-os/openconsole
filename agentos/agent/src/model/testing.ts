import type { Model, Profile } from "./types";

export type Chunk = Readonly<Record<string, unknown>>;

export type Body = Readonly<Record<string, unknown>>;

export type Reply = Response | ((body: Body) => Response);

export interface Script {
  readonly model: Model;
  readonly requests: Body[];
  readonly urls: string[];
}

const usage = { prompt_tokens: 10, completion_tokens: 5 };

export function sse(chunks: readonly Chunk[], gap = 0): Response {
  const events = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ];
  const headers = { "content-type": "text/event-stream" };
  if (gap === 0) return new Response(events.join(""), { headers });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
        await new Promise((resolve) => setTimeout(resolve, gap));
      }
      controller.close();
    },
  });
  return new Response(body, { headers });
}

export function say(content: string): Chunk[] {
  const middle = Math.ceil(content.length / 2);
  return [
    {
      choices: [
        { delta: { role: "assistant", content: content.slice(0, middle) } },
      ],
    },
    { choices: [{ delta: { content: content.slice(middle) } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage },
  ];
}

export function lines(...rows: readonly string[]): Chunk[] {
  return [
    ...rows.map((row) => ({ choices: [{ delta: { content: `${row}\n` } }] })),
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage },
  ];
}

export function invoke(
  calls: readonly { readonly name: string; readonly args: unknown }[],
): Chunk[] {
  const parts = calls.flatMap((call, index) => {
    const json =
      typeof call.args === "string" ? call.args : JSON.stringify(call.args);
    const middle = Math.floor(json.length / 2);
    return [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index,
                  id: `call_${index}`,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: json.slice(0, middle),
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index, function: { arguments: json.slice(middle) } },
              ],
            },
          },
        ],
      },
    ];
  });
  return [
    ...parts,
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage },
  ];
}

export function script(
  replies: readonly Reply[],
  profile: Partial<Profile> = {},
): Script {
  const queue = [...replies];
  const requests: Body[] = [];
  const urls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    requests.push(body);
    urls.push(String(input));
    const next = queue.shift();
    if (next === undefined) throw new Error("no scripted reply left");
    return typeof next === "function" ? next(body) : next;
  };
  return {
    model: {
      model: "test",
      baseURL: "https://model.test/v1/",
      apiKey: "secret",
      fetch: fake,
      retries: 0,
      profile,
    },
    requests,
    urls,
  };
}

export function messages(body: Body): Readonly<Record<string, unknown>>[] {
  return body["messages"] as Readonly<Record<string, unknown>>[];
}
