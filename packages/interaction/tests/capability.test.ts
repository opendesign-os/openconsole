import { describe, expect, it } from "vitest";

import { plane } from "@openconsole/matrix";

import {
  Capability,
  Shape,
  Store,
  type CapabilityOptions,
  type Part,
  type State,
  type Unit,
} from "../model";

interface Options extends CapabilityOptions {
  readonly count: number;
}

class Probe implements Unit {
  active = false;
  alive = true;

  destroy(): void {
    this.alive = false;
  }
}

class Counter extends Capability<string, Options, Probe> {
  built: Probe[] = [];
  cleaned = 0;

  constructor(node: string, options: Options) {
    super(node, options);
    this.refresh();
  }

  protected build(): readonly Part<Probe>[] {
    this.built = Array.from({ length: this.options.count }, () => new Probe());
    return [...this.built, () => (this.cleaned += 1)];
  }
}

class Box extends Shape<string, CapabilityOptions> {
  protected build(): readonly Part[] {
    return [];
  }
}

const initial: State = {
  matrix: plane.identity,
  size: { width: 10, height: 10 },
};

describe("Capability", () => {
  it("rebuilds with merged options and releases the previous parts", () => {
    const counter = new Counter("node", { count: 1 });
    const [first] = counter.built;
    counter.update({ count: 2 });
    expect(first?.alive).toBe(false);
    expect(counter.cleaned).toBe(1);
    expect(counter.built).toHaveLength(2);
    expect(counter.node).toBe("node");
  });

  it("reports activity from its units", () => {
    const counter = new Counter("node", { count: 2 });
    expect(counter.active).toBe(false);
    counter.built[1]!.active = true;
    expect(counter.active).toBe(true);
  });

  it("destroys once and stops rebuilding", () => {
    const counter = new Counter("node", { count: 1 });
    counter.destroy();
    counter.destroy();
    counter.refresh();
    expect(counter.cleaned).toBe(1);
    expect(counter.active).toBe(false);
    expect(counter.built.every((probe) => !probe.alive)).toBe(true);
  });

  it("destroys when the signal aborts", () => {
    const controller = new AbortController();
    const counter = new Counter("node", {
      count: 1,
      signal: controller.signal,
    });
    controller.abort();
    expect(counter.cleaned).toBe(1);
    const late = new Counter("node", { count: 1, signal: controller.signal });
    expect(late.built).toHaveLength(0);
  });
});

describe("Shape", () => {
  it("reads and assigns the shared state", () => {
    const store = new Store(initial);
    const box = new Box("node", store, {});
    const matrix = plane.translate(5, 0);
    box.assign({ matrix });
    expect(box.state.matrix).toEqual(matrix);
    expect(box.state).toBe(store.state);
  });
});
