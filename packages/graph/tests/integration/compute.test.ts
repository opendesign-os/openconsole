import { describe, expect, it } from "vitest";

import {
  closure,
  components,
  dominators,
  Interrupted,
  nodeId,
  scc,
  schedule,
  settle,
  shortestPaths,
  Snapshot,
  toposort,
  type Task,
} from "../../index";
import { randomGraph, weighted } from "../support";

/**
 * 计算侧的端到端：一份快照搬过线程边界、被中断又续跑、分帧推进，最终结果必须与
 * 「主线程上一口气跑完」逐位相同。
 *
 * 这三件事各自都有单元测试，但它们组合起来才是真实用法——`postMessage` 一份快照到
 * Worker，那边分帧跑长任务、期间用户又取消了一次。任何一环丢状态，症状都是「偶尔算错」。
 */

const sample = (): Snapshot =>
  weighted(randomGraph(2027, { order: 300, density: 3 }));

/** 与 `postMessage` 同一套结构化克隆，因此能代表真实的跨线程搬运。 */
const ferry = (snapshot: Snapshot, labels: boolean): Snapshot =>
  Snapshot.from(structuredClone(labels ? snapshot.data : snapshot.core));

describe("跨线程搬运后结果不变", () => {
  const algorithms = [
    ["scc", (s: Snapshot) => [...settle(scc(s)).component]],
    ["components", (s: Snapshot) => [...settle(components(s)).component]],
    [
      "shortestPaths",
      (s: Snapshot) => [...settle(shortestPaths(s, 0)).distance],
    ],
    ["dominators", (s: Snapshot) => [...settle(dominators(s, 0))]],
    ["closure", (s: Snapshot) => [...settle(closure(s)).from(0)]],
  ] as const;

  it.each(algorithms)("%s 在 data 与 core 两种搬法上都一致", (_label, run) => {
    const origin = sample();
    const expected = run(origin);

    expect(run(ferry(origin, true))).toEqual(expected);
    expect(run(ferry(origin, false))).toEqual(expected);
  });

  it("core 搬法省掉标签层：索引空间照跑，问名字明确报错", () => {
    const origin = sample();
    const bare = ferry(origin, false);

    expect(bare.order).toBe(origin.order);
    expect([...bare.weight!]).toEqual([...origin.weight!]);
    expect(bare.at(0)).toBeUndefined();
    expect(bare.indexOf(nodeId("n0"))).toBe(-1);
    expect(() => bare.names([0])).toThrow(/without the label layer/);
  });

  it("搬过去的快照没有源图，因此不会误报陈旧", () => {
    const origin = sample();
    const moved = ferry(origin, true);
    expect(moved.current).toBe(true);
    expect(() => moved.verify()).not.toThrow();
  });
});

describe("中断、续跑与分帧的组合", () => {
  /** 推进到大约一半就中断，返回停在半途的任务。 */
  const halfway = <T>(task: Task<T>): Task<T> => {
    while (task.progress < 0.5 && task.advance(1));
    return task;
  };

  it("中断后续跑与一口气跑完结果相同", () => {
    const snapshot = ferry(sample(), true);
    const controller = new AbortController();

    const task = halfway(scc(snapshot));
    controller.abort();
    expect(() => settle(task, controller.signal)).toThrow(Interrupted);
    expect(task.settled).toBe(false);

    expect([...settle(task).component]).toEqual([
      ...settle(scc(snapshot)).component,
    ]);
  });

  it("半途改用 schedule 分帧跑完，结果依旧一致", async () => {
    const snapshot = ferry(sample(), true);
    const task = halfway(closure(snapshot));

    const seen: number[] = [];
    // 预算要够大：单步是一条邻接槽，而每帧让出受 setTimeout 的 ~15ms 粒度限制，
    // 预算调小只是把帧数拖成几百，测不出更多东西。
    const result = await schedule(task, {
      budget: 64,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen[seen.length - 1]).toBe(1);
    expect([...result.from(0)]).toEqual([...settle(closure(snapshot)).from(0)]);
  });

  it("多次中断、每次换不同预算，结果仍然一致", () => {
    const snapshot = ferry(sample(), false);
    const expected = [...settle(shortestPaths(snapshot, 0)).distance];

    const task = shortestPaths(snapshot, 0);
    for (const budget of [1, 7, 3, 64, 2]) {
      const controller = new AbortController();
      controller.abort();
      try {
        settle(task, controller.signal);
      } catch (error) {
        expect(error).toBeInstanceOf(Interrupted);
      }
      task.advance(budget);
    }

    expect([...settle(task).distance]).toEqual(expected);
  });

  it("跑完之后重复 settle 不改变结果", () => {
    const snapshot = ferry(
      weighted(randomGraph(2028, { order: 300, density: 3, acyclic: true })),
      true,
    );
    const task = toposort(snapshot);
    const first = [...settle(task)];

    expect([...settle(task)]).toEqual(first);
    expect(first).toHaveLength(snapshot.order);
  });
});
