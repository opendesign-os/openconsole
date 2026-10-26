import {
  check,
  extract,
  ValidationError,
  type JsonSchema,
  type Kind,
  type Values,
} from "../common";
import { complete, profileOf, type ChatModel, type Message } from "../model";

export interface Example {
  readonly input: Values;
  readonly output: Values;
}

export interface Prompt {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly examples?: readonly Example[];
}

export function prompt(spec: Prompt, model: ChatModel, attempts = 2): Kind {
  const system =
    profileOf(model).structured === "schema"
      ? `${spec.systemPrompt}\n\nReply with a single JSON object.`
      : `${spec.systemPrompt}\n\nReply with a single JSON object matching this JSON Schema:\n${JSON.stringify(spec.outputSchema)}`;
  const shots = (spec.examples ?? []).flatMap((example): Message[] => [
    { role: "user", content: JSON.stringify(example.input) },
    { role: "assistant", content: JSON.stringify(example.output) },
  ]);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    run: async (input, context) => {
      const messages: Message[] = [
        { role: "system", content: system },
        ...shots,
        { role: "user", content: JSON.stringify(input) },
      ];
      for (let attempt = 1; ; attempt++) {
        const reply = await complete(
          model,
          {
            messages,
            responseFormat: { name: spec.name, schema: spec.outputSchema },
          },
          { signal: context.signal, delta: context.emit },
        );
        context.spend(reply.usage);
        const parsed = extract(reply.content);
        const problems =
          parsed === undefined
            ? ["the reply is not a JSON object"]
            : check(spec.outputSchema, parsed);
        if (parsed !== undefined && problems.length === 0) return parsed;
        if (attempt >= attempts) {
          throw new ValidationError(`reply of ${spec.name}`, problems);
        }
        messages.push(
          { role: "assistant", content: reply.content },
          {
            role: "user",
            content: `That reply was invalid: ${problems.join("; ")}. Reply again with only the JSON object.`,
          },
        );
      }
    },
  };
}
