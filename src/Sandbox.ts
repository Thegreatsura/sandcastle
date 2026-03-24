import { Context, Effect } from "effect";
import type { CopyError, ExecError } from "./errors.js";

export { type SandboxError } from "./errors.js";
export {
  ExecError,
  ExecHostError,
  CopyError,
  DockerError,
  SyncError,
  PromptError,
  AgentError,
  ConfigDirError,
  InitError,
} from "./errors.js";

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SandboxService {
  readonly exec: (
    command: string,
    options?: { cwd?: string },
  ) => Effect.Effect<ExecResult, ExecError>;

  readonly execStreaming: (
    command: string,
    onStdoutLine: (line: string) => void,
    options?: { cwd?: string },
  ) => Effect.Effect<ExecResult, ExecError>;

  readonly copyIn: (
    hostPath: string,
    sandboxPath: string,
  ) => Effect.Effect<void, CopyError>;

  readonly copyOut: (
    sandboxPath: string,
    hostPath: string,
  ) => Effect.Effect<void, CopyError>;
}

export class Sandbox extends Context.Tag("Sandbox")<
  Sandbox,
  SandboxService
>() {}
