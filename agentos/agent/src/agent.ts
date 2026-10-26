import {
  nest,
  Runner,
  Workflow,
  type Blueprint,
  type Limits,
  type Operator,
  type Policy,
  type Resume,
  type Run,
  type RunEvent,
  type RunOptions,
  type Store,
  type Values,
} from "@openagent/core";

import { PluginManager } from "@openconsole/plugable";

import { resolve, type Model } from "./model";
import { loop, type Planner, type Prepare } from "./planner";
import {
  createHooks,
  guard,
  type AgentHooks,
  type AgentHost,
  type AgentPlugin,
} from "./plugin";
import type { Toolkit } from "./tool";

export type Tool = Operator | Toolkit | Runner;

export type Input = string | Values | Resume;

export interface AgentOptions {
  readonly name: string;
  readonly description?: string;
  readonly model: string | Model;
  readonly instructions?: string;
  readonly tools?: readonly Tool[];
  readonly plugins?: readonly AgentPlugin[];
  readonly planner?: Planner;
  readonly store?: Store;
  readonly limits?: Limits;
  readonly policy?: Policy;
}

interface Built {
  readonly blueprint: Blueprint;
  readonly hooks: AgentHooks;
  readonly manager: PluginManager<AgentHooks, AgentHost>;
}

export class Agent extends Runner {
  private _built: Promise<Built> | undefined;

  public constructor(private readonly _options: AgentOptions) {
    super({
      name: _options.name,
      limits: { nodes: 1_000, ..._options.limits },
      ...(_options.description === undefined
        ? {}
        : { description: _options.description }),
      ...(_options.store === undefined ? {} : { store: _options.store }),
      ...(_options.policy === undefined ? {} : { policy: _options.policy }),
    });
  }

  public run(input: Input, options?: RunOptions): Promise<Run> {
    return super.run(typeof input === "string" ? ask(input) : input, options);
  }

  public stream(
    input: Input,
    options?: RunOptions,
  ): AsyncGenerator<RunEvent, void, undefined> {
    return super.stream(
      typeof input === "string" ? ask(input) : input,
      options,
    );
  }

  public async dispose(): Promise<void> {
    const built = this._built;
    this._built = undefined;
    if (built !== undefined) await (await built).manager.dispose();
  }

  protected async blueprint(): Promise<Blueprint> {
    return (await this._build()).blueprint;
  }

  protected async opened(run: Run): Promise<void> {
    await (await this._build()).hooks.start.call(run);
  }

  protected async closed(run: Run): Promise<void> {
    await (await this._build()).hooks.end.call(run);
  }

  private _build(): Promise<Built> {
    this._built ??= this._assemble();
    return this._built;
  }

  private async _assemble(): Promise<Built> {
    const options = this._options;
    const model = resolve(options.model);
    const hooks = createHooks();
    const manager = new PluginManager(hooks, {
      cwd: ".",
      agent: this.name,
      model,
      store: this.store,
      runs: (session: string) => this.runs(session),
    });
    const plugins = new Map<string, AgentPlugin>();
    for (const plugin of options.plugins ?? []) {
      if (!plugins.has(plugin.name)) plugins.set(plugin.name, plugin);
    }
    await manager.use([...plugins.values()]);
    const instructions =
      options.instructions === undefined ? [] : [options.instructions];
    const operators: Operator[] = [];
    for (const tool of options.tools ?? []) {
      if (tool instanceof Runner) {
        operators.push(nest(tool));
      } else if ("tools" in tool) {
        operators.push(...tool.tools);
        if (tool.instructions !== undefined)
          instructions.push(tool.instructions);
      } else {
        operators.push(tool);
      }
    }
    const tools = (await hooks.tools.call({ agent: this.name }, operators)).map(
      (tool) => guard(tool, hooks),
    );
    const prepare: Prepare = (conversation, context) =>
      hooks.context.call({ context }, conversation);
    const planner = (options.planner ?? loop())({
      name: this.name,
      model,
      instructions: instructions.join("\n\n"),
      tools,
      prepare,
    });
    const flow = new Workflow({ name: this.name }).node(this.name, planner);
    return {
      blueprint: { template: flow.template, operators: flow.operators },
      hooks,
      manager,
    };
  }
}

function ask(content: string): Values {
  return { messages: [{ role: "user", content }] };
}
