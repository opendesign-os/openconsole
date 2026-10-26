import { describe, expect, it } from "vitest";

import { distill, Memory } from "../../index";
import { messages, say, script, sse } from "../../testing";

const episode = (id: string, time = "2026-10-26T00:00:00.000Z") => ({
  id,
  time,
});

describe("Memory", () => {
  it("merges the same entities and facts into one graph", () => {
    const memory = new Memory();
    memory.merge(
      {
        entities: [
          { name: "Ann", summary: "The user." },
          { name: "Beijing", summary: "A city." },
        ],
        facts: [
          {
            subject: "Ann",
            relation: "lives in",
            object: "Beijing",
            statement: "Ann lives in Beijing.",
          },
        ],
      },
      episode("r1"),
    );
    memory.merge(
      {
        entities: [{ name: "ann", summary: "The user, a runner." }],
        facts: [
          {
            subject: "ANN",
            relation: "lives_in",
            object: "beijing",
            statement: "Ann lives in Beijing now.",
          },
        ],
      },
      episode("r2"),
    );
    expect(memory.entities).toBe(2);
    expect(memory.facts).toBe(1);
    const recalled = memory.recall("Where does Ann live?");
    expect(recalled).toContain(
      "- Ann lives in Beijing now. (since 2026-10-26)",
    );
    expect(recalled).toContain("- Ann: The user, a runner.");
  });

  it("invalidates contradicted facts instead of deleting them", () => {
    const memory = new Memory();
    memory.merge(
      {
        facts: [
          {
            subject: "Ann",
            relation: "lives_in",
            object: "Beijing",
            statement: "Ann lives in Beijing.",
          },
        ],
      },
      episode("r1", "2026-01-01T00:00:00.000Z"),
    );
    memory.merge(
      {
        facts: [
          {
            subject: "Ann",
            relation: "lives_in",
            object: "Shanghai",
            statement: "Ann moved to Shanghai.",
          },
        ],
        expired: [{ subject: "Ann", relation: "lives_in", object: "Beijing" }],
      },
      episode("r2", "2026-06-01T00:00:00.000Z"),
    );
    const recalled = memory.recall("Ann");
    expect(recalled).toContain("- Ann moved to Shanghai. (since 2026-06-01)");
    expect(recalled).not.toContain("Ann lives in Beijing.");
    expect(memory.facts).toBe(1);
    const restored = new Memory(JSON.parse(JSON.stringify(memory.pack())));
    expect(restored.recall("Ann")).toBe(recalled);
  });

  it("ranks the facts around the entities in the query first", () => {
    const memory = new Memory();
    memory.merge(
      {
        facts: [
          {
            subject: "Ann",
            relation: "likes",
            object: "running",
            statement: "Ann likes running.",
          },
          {
            subject: "Bob",
            relation: "likes",
            object: "chess",
            statement: "Bob likes chess.",
          },
        ],
      },
      episode("r1"),
    );
    const recalled = memory.recall("What does Bob like?", 20);
    expect(recalled).toContain("Bob likes chess.");
    expect(recalled).not.toContain("Ann likes running.");
  });

  it("distills a conversation with the existing memory in view", async () => {
    const memory = new Memory();
    memory.merge(
      {
        facts: [
          {
            subject: "Ann",
            relation: "lives_in",
            object: "Beijing",
            statement: "Ann lives in Beijing.",
          },
        ],
      },
      episode("r1"),
    );
    const { model, requests } = script([
      sse(
        say(
          JSON.stringify({
            entities: [{ name: "Shanghai", summary: "A city." }],
            facts: [
              {
                subject: "Ann",
                relation: "lives_in",
                object: "Shanghai",
                statement: "Ann moved to Shanghai.",
              },
            ],
            expired: [
              { subject: "Ann", relation: "lives_in", object: "Beijing" },
            ],
          }),
        ),
      ),
    ]);
    const { update } = await distill(
      [{ role: "user", content: "Ann moved to Shanghai." }],
      memory,
      model,
    );
    expect(update.expired).toEqual([
      { subject: "Ann", relation: "lives_in", object: "Beijing" },
    ]);
    expect(String(messages(requests[0] ?? {})[1]?.["content"])).toContain(
      "Existing memory:\n<facts>\n- Ann lives in Beijing.",
    );
  });
});
