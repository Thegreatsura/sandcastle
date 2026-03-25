import { Context, Effect, Layer } from "effect";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DockerSandbox } from "./DockerSandbox.js";
import { startContainer, removeContainer } from "./DockerLifecycle.js";
import type { DockerError } from "./errors.js";
import { Sandbox } from "./Sandbox.js";

export class SandboxConfig extends Context.Tag("SandboxConfig")<
  SandboxConfig,
  {
    readonly imageName: string;
    readonly env: Record<string, string>;
  }
>() {}

export class SandboxFactory extends Context.Tag("SandboxFactory")<
  SandboxFactory,
  {
    readonly withSandbox: <A, E, R>(
      effect: Effect.Effect<A, E, R | Sandbox>,
    ) => Effect.Effect<A, E | DockerError, Exclude<R, Sandbox>>;
  }
>() {}

/**
 * Synchronously force-remove a Docker container.
 * Used in process exit handlers where async operations are not possible.
 */
const forceRemoveContainerSync = (containerName: string): void => {
  try {
    execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  } catch {
    // Best-effort — container may already be gone
  }
};

export const DockerSandboxFactory = {
  layer: Layer.effect(
    SandboxFactory,
    Effect.gen(function* () {
      const { imageName, env } = yield* SandboxConfig;
      return {
        withSandbox: <A, E, R>(
          effect: Effect.Effect<A, E, R | Sandbox>,
        ): Effect.Effect<A, E | DockerError, Exclude<R, Sandbox>> => {
          const containerName = `sandcastle-${randomUUID()}`;

          const cleanup = () => forceRemoveContainerSync(containerName);
          const onSignal = () => {
            cleanup();
            process.exit(1);
          };

          return Effect.acquireUseRelease(
            startContainer(containerName, imageName, env).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  process.on("exit", cleanup);
                  process.on("SIGINT", onSignal);
                  process.on("SIGTERM", onSignal);
                }),
              ),
            ),
            () =>
              effect.pipe(
                Effect.provide(DockerSandbox.layer(containerName)),
              ) as Effect.Effect<A, E | DockerError, Exclude<R, Sandbox>>,
            () =>
              Effect.sync(() => {
                process.removeListener("exit", cleanup);
                process.removeListener("SIGINT", onSignal);
                process.removeListener("SIGTERM", onSignal);
              }).pipe(
                Effect.andThen(removeContainer(containerName)),
                Effect.orDie,
              ),
          );
        },
      };
    }),
  ),
};
