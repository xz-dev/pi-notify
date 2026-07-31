import { spawn as nodeSpawn } from "node:child_process";

import type { NotificationEnvironment } from "./types.js";

interface ChildProcessLike {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
}

interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: true;
  detached: true;
  stdio: "ignore";
  windowsHide: true;
}

interface CommandLauncherOptions {
  inheritedEnvironment?: NodeJS.ProcessEnv;
  spawn?: (command: string, options: SpawnOptions) => ChildProcessLike;
  warn: (message: string) => void;
}

function clearNotificationEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("PI_NOTIFY_")) delete environment[key];
  }
}

export function createCommandLauncher(options: CommandLauncherOptions) {
  const inheritedEnvironment = options.inheritedEnvironment ?? process.env;
  const spawn = options.spawn ?? ((command, spawnOptions) => nodeSpawn(command, spawnOptions));

  return (command: string, cwd: string, notificationEnvironment: NotificationEnvironment): void => {
    const env: NodeJS.ProcessEnv = { ...inheritedEnvironment };
    clearNotificationEnvironment(env);
    for (const [key, value] of Object.entries(notificationEnvironment)) env[key] = value;

    try {
      const child = spawn(command, {
        cwd,
        env,
        shell: true,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", (error) => options.warn(`Cannot launch notification command: ${error.message}`));
      child.unref();
    } catch (error) {
      options.warn(`Cannot launch notification command: ${String(error)}`);
    }
  };
}
