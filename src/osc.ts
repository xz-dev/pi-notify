import { spawn } from "node:child_process";

import { resolvePowerShell, type PowerShellResolverOptions } from "./powershell.js";

interface ChildProcessLike {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
}

interface OscLauncherOptions {
  environment?: NodeJS.ProcessEnv;
  write?: (value: string) => void;
  spawnWindowsToast?: (title: string, body: string) => void;
  resolvePowerShell?: () => string | undefined;
  spawn?: (
    command: string,
    args: string[],
    options: {
      detached: true;
      stdio: "ignore";
      windowsHide: true;
    },
  ) => ChildProcessLike;
  warn: (message: string) => void;
}

function safeText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/;/g, ",");
}

function tmuxPassthrough(sequence: string, environment: NodeJS.ProcessEnv): string {
  if (!environment.TMUX) return sequence;
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}

function windowsToastScript(title: string, body: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return [
    "$type = 'Windows.UI.Notifications'",
    "$manager = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
    "$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02",
    "$xml = $manager::GetTemplateContent($template)",
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode(${quote(title)})) > $null`,
    `$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode(${quote(body)})) > $null`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "$manager::CreateToastNotifier('Pi').Show($toast)",
  ].join("; ");
}

function writeOscSequences(
  title: string,
  body: string,
  environment: NodeJS.ProcessEnv,
  write: (value: string) => void,
): void {
  const sequences = environment.KITTY_WINDOW_ID
    ? [`\x1b]99;i=pi-notify:d=0;${title}\x1b\\`, `\x1b]99;i=pi-notify:p=body;${body}\x1b\\`]
    : environment.TERM_PROGRAM === "iTerm.app" || environment.ITERM_SESSION_ID
      ? [`\x1b]9;${title}: ${body}\x07`]
      : [`\x1b]777;notify;${title};${body}\x07`];
  for (const sequence of sequences) write(tmuxPassthrough(sequence, environment));
}

export function createOscLauncher(options: OscLauncherOptions) {
  const environment = options.environment ?? process.env;
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const resolvePs =
    options.resolvePowerShell ??
    (() => resolvePowerShell({ env: environment } satisfies PowerShellResolverOptions));
  const spawnChild =
    options.spawn ??
    ((command, args, spawnOptions) => spawn(command, args, spawnOptions) as ChildProcessLike);

  const defaultSpawnWindowsToast = (title: string, body: string): void => {
    const powershell = resolvePs();
    if (!powershell) {
      options.warn("Cannot launch Windows notification: powershell unavailable; falling back to terminal OSC");
      writeOscSequences(title, body, environment, write);
      return;
    }

    const encodedCommand = Buffer.from(windowsToastScript(title, body), "utf16le").toString("base64");
    let fellBack = false;
    // Separate setup-error capture from fallback execution so a throwing OSC write
    // propagates to runActions and is not swallowed by the toast setup catch.
    let fallbackReason: string | undefined;
    const requestFallback = (reason: string) => {
      if (fellBack || fallbackReason !== undefined) return;
      fallbackReason = reason;
    };
    const runFallbackIfRequested = () => {
      if (fellBack || fallbackReason === undefined) return;
      fellBack = true;
      options.warn(`Cannot launch Windows notification: ${fallbackReason}; falling back to terminal OSC`);
      writeOscSequences(title, body, environment, write);
    };
    const fallbackOnce = (reason: string) => {
      requestFallback(reason);
      runFallbackIfRequested();
    };

    try {
      const child = spawnChild(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", (error) => fallbackOnce(error.message));
      try {
        child.unref();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        requestFallback(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      requestFallback(message);
    }

    runFallbackIfRequested();
  };

  const spawnWindowsToast = options.spawnWindowsToast ?? defaultSpawnWindowsToast;

  // Synchronous OSC write/spawn failures must surface to runActions (agent_notify aggregates them).
  // Lifecycle paths catch via runActions throwOnFailure=false.
  return (rawTitle: string, rawBody: string): void => {
    const title = safeText(rawTitle);
    const body = safeText(rawBody);

    if (environment.WT_SESSION) {
      spawnWindowsToast(title, body);
      return;
    }

    writeOscSequences(title, body, environment, write);
  };
}
