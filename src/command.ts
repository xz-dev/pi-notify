import { spawn as nodeSpawn } from "node:child_process";

import type { ActionExecutionObserver, NotificationEnvironment } from "./types.js";

interface ChildProcessLike {
  once(event: string, listener: (...args: any[]) => void): unknown;
  unref(): void;
}

interface CommandSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: true;
  detached: true;
  stdio: "ignore";
  windowsHide: true;
}

interface ShellSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  detached: true;
  stdio: "ignore";
  windowsHide: true;
}

interface CommandLauncherOptions {
  inheritedEnvironment?: NodeJS.ProcessEnv;
  spawn?: (command: string, options: CommandSpawnOptions) => ChildProcessLike;
  warn: (message: string) => void;
}

interface ShellLauncherOptions {
  inheritedEnvironment?: NodeJS.ProcessEnv;
  spawn?: (executable: string, args: readonly string[], options: ShellSpawnOptions) => ChildProcessLike;
  warn: (message: string) => void;
}

export class CommandLaunchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CommandLaunchError";
  }
}

function clearNotificationEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("PI_NOTIFY_")) delete environment[key];
  }
}

function buildEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv,
  notificationEnvironment: NotificationEnvironment,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...inheritedEnvironment };
  clearNotificationEnvironment(env);
  for (const [key, value] of Object.entries(notificationEnvironment)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function observeChild(child: ChildProcessLike, noun: string, observer: ActionExecutionObserver): void {
  child.once("error", (error) => observer.reportFailure(error));
  child.once("exit", (code, signal) => {
    if (code === 0 && signal === null) return;
    const outcome = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    observer.reportFailure(new Error(`Notification ${noun} exited with ${outcome}`));
  });
}

export function createCommandLauncher(options: CommandLauncherOptions) {
  const inheritedEnvironment = options.inheritedEnvironment ?? process.env;
  const spawn = options.spawn ?? ((command, spawnOptions) => nodeSpawn(command, spawnOptions));

  return (
    command: string,
    cwd: string,
    notificationEnvironment: NotificationEnvironment,
    observer?: ActionExecutionObserver,
  ): void => {
    const env = buildEnvironment(inheritedEnvironment, notificationEnvironment);

    try {
      const child = spawn(command, {
        cwd,
        env,
        shell: true,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      if (observer) observeChild(child, "command", observer);
      else child.once("error", (error) => options.warn(`Cannot launch notification command: ${error.message}`));
      child.unref();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!observer) options.warn(`Cannot launch notification command: ${message}`);
      throw new CommandLaunchError(`Cannot launch notification command: ${message}`, { cause: error });
    }
  };
}

export function createShellLauncher(options: ShellLauncherOptions) {
  const inheritedEnvironment = options.inheritedEnvironment ?? process.env;
  const spawn =
    options.spawn ??
    ((executable, args, spawnOptions) =>
      nodeSpawn(executable, [...args], spawnOptions) as ChildProcessLike);

  return (
    executable: string,
    args: readonly string[],
    cwd: string,
    notificationEnvironment: NotificationEnvironment,
    observer?: ActionExecutionObserver,
  ): void => {
    const env = buildEnvironment(inheritedEnvironment, notificationEnvironment);

    try {
      const child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      if (observer) observeChild(child, "shell", observer);
      else child.once("error", (error) => options.warn(`Cannot launch notification shell: ${error.message}`));
      child.unref();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!observer) options.warn(`Cannot launch notification shell: ${message}`);
      throw new CommandLaunchError(`Cannot launch notification shell: ${message}`, { cause: error });
    }
  };
}
