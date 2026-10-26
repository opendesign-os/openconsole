export class Command {
  public readonly resume: unknown;

  public constructor(fields: { readonly resume?: unknown } = {}) {
    this.resume = fields.resume;
  }
}
