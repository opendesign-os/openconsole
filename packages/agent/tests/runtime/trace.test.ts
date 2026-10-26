import { describe, expect, it } from "vitest";

import { Interrupted, run } from "@openconsole/graph";

import {
  assemble,
  registry,
  resume,
  save,
  Session,
  tool,
  type Trace,
} from "../../index";
import { finish, id } from "../support";

describe("trace", () => {
  it("saves a session and resumes it without redoing finished work", async () => {
    let counted = 0;
    const count = tool(() => ++counted, {
      name: "count",
      description: "Counts its runs.",
    });
    let calls = 0;
    const slow = tool(
      (input, context) => {
        calls++;
        if (calls > 1) return input["value"];
        return new Promise((_, reject) => {
          context.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
      {
        name: "slow",
        description: "Hangs on the first run.",
        schema: { type: "object", properties: { value: {} } },
      },
    );
    const kinds = registry(count, slow, finish);
    const graph = assemble(
      {
        nodes: [
          { id: "c", kind: "count" },
          { id: "s", kind: "slow" },
          { id: "f", kind: "finish" },
        ],
        edges: [
          { from: ["c", "result"], to: ["s", "value"] },
          { from: ["s", "result"], to: ["f", "value"] },
        ],
      },
      kinds,
    );
    const first = new Session(graph, { kinds });
    first.signal.on("started", ({ node }) => {
      if (node === "s") queueMicrotask(() => first.cancel());
    });
    await expect(run(first)).rejects.toBeInstanceOf(Interrupted);

    const trace = JSON.parse(JSON.stringify(save(first))) as Trace;
    const second = resume(trace, { kinds });
    expect(second.state(id("c"))?.status).toBe("done");
    expect(second.state(id("s"))?.status).toBe("waiting");
    await run(second);
    expect(second.values).toEqual({ answer: 1 });
    expect(counted).toBe(1);
  });
});
