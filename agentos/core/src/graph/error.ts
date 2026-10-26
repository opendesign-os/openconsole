export class RuntimeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DefinitionError extends RuntimeError {
  public constructor(reason: string) {
    super("definition", reason);
  }
}

export class PlanError extends RuntimeError {
  public constructor(reason: string) {
    super("plan", `invalid plan: ${reason}`);
  }
}

export class LimitError extends RuntimeError {
  public constructor(
    public readonly limit: "nodes" | "tokens",
    public readonly value: number,
  ) {
    super("limit", `the ${limit} limit of ${value} was reached`);
  }
}

export class TimeoutError extends RuntimeError {
  public constructor(public readonly timeout: number) {
    super("timeout", `the attempt took longer than ${timeout} ms`);
  }
}

export class ValidationError extends RuntimeError {
  public constructor(
    subject: string,
    public readonly problems: readonly string[],
  ) {
    super("validation", `${subject} is invalid: ${problems.join("; ")}`);
  }
}

export class Pause extends RuntimeError {
  public constructor(public readonly value: unknown) {
    super("pause", "the node is waiting to be resumed");
  }
}
