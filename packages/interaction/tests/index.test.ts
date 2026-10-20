import { describe, expect, it } from "vitest";

describe("index", () => {
  it("loads without a DOM", async () => {
    expect(typeof document).toBe("undefined");
    const api = await import("../index");
    expect(typeof api.Draggable).toBe("function");
    expect(typeof api.bind).toBe("function");
    expect(typeof api.transform).toBe("function");
  });
});
