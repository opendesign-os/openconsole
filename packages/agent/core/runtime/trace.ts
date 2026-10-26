import { pack, unpack, type Bundle, type NodeId } from "@openconsole/graph";

import type { Weight } from "../common";
import { Session, type SessionOptions, type State } from "./session";

export interface Trace {
  readonly graph: Bundle<Weight, unknown>;
  readonly states: readonly (readonly [NodeId, State])[];
}

export function save(session: Session): Trace {
  return { graph: pack(session.graph), states: [...session.states()] };
}

export function resume(
  trace: Trace,
  options: Omit<SessionOptions, "states">,
): Session {
  return new Session(unpack(trace.graph), { ...options, states: trace.states });
}
