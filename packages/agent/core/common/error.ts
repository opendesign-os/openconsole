export class AgentError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class GraphValueError extends AgentError {
  public constructor(reason: string) {
    super("graph_value", reason);
  }
}

export class InvalidUpdateError extends AgentError {
  public constructor(reason: string) {
    super("invalid_update", `invalid graph update: ${reason}`);
  }
}

export class GraphRecursionError extends AgentError {
  public constructor(public readonly limit: number) {
    super("recursion_limit", `recursion limit of ${limit} nodes reached`);
  }
}

export class TokenLimitError extends AgentError {
  public constructor(public readonly limit: number) {
    super("token_limit", `token limit of ${limit} reached`);
  }
}

export class ValidationError extends AgentError {
  public constructor(
    subject: string,
    public readonly problems: readonly string[],
  ) {
    super("validation", `${subject} is invalid: ${problems.join("; ")}`);
  }
}

export class APIError extends AgentError {
  public constructor(
    public readonly status: number,
    detail: string,
  ) {
    super("api", `model request failed (${status}): ${detail}`);
  }
}

export class GraphInterrupt extends AgentError {
  public constructor(public readonly value: unknown) {
    super("interrupt", "the node is waiting to be resumed");
  }
}
