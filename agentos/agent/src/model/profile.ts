import type { Model, Profile } from "./types";

export const standard: Profile = {
  tools: true,
  structured: "schema",
  reasoning: "drop",
  limit: "max_tokens",
  usage: true,
};

export const profile = (model: Model): Profile => ({
  ...standard,
  ...model.profile,
});
