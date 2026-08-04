import { spawn } from "node:child_process";

import { resolvePowerShell, type PowerShellResolverOptions } from "./powershell.js";
import type { ActionExecutionObserver } from "./types.js";

interface ChildProcessLike {
  once(event: string, listener: (...args: any[]) => void): unknown;
  unref(): void;
}

interface OscLauncherOptions {
  environment?: NodeJS.ProcessEnv;
  write?: (value: string) => void;
  spawnWindowsToast?: (title: string, body: string, observer?: ActionExecutionObserver) => void;
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

/** Normalize newlines and strip C0/C1 controls except LF (keeps multiline bodies). */
function sanitizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

/** OSC 9 / OSC 777 use ';' as a field delimiter — keep payload fields single-token. */
function forDelimiterProtocol(value: string): string {
  return value.replace(/;/g, ",");
}

function kittyBase64Payload(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
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
  let sequences: string[];
  if (environment.KITTY_WINDOW_ID) {
    // Official Kitty OSC 99: e=1 Base64 UTF-8 payload preserves LF safely.
    sequences = [
      `\x1b]99;i=pi-notify:d=0:e=1;${kittyBase64Payload(title)}\x1b\\`,
      `\x1b]99;i=pi-notify:p=body:e=1;${kittyBase64Payload(body)}\x1b\\`,
    ];
  } else if (environment.TERM_PROGRAM === "iTerm.app" || environment.ITERM_SESSION_ID) {
    const safeTitle = forDelimiterProtocol(title);
    const safeBody = forDelimiterProtocol(body);
    sequences = [`\x1b]9;${safeTitle}: ${safeBody}\x07`];
  } else {
    const safeTitle = forDelimiterProtocol(title);
    const safeBody = forDelimiterProtocol(body);
    sequences = [`\x1b]777;notify;${safeTitle};${safeBody}\x07`];
  }
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

  const defaultSpawnWindowsToast = (
    title: string,
    body: string,
    observer?: ActionExecutionObserver,
  ): void => {
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
      if (observer && !observer.isCurrent()) return;
      options.warn(`Cannot launch Windows notification: ${fallbackReason}; falling back to terminal OSC`);
      try {
        writeOscSequences(title, body, environment, write);
      } catch (error) {
        observer?.reportFailure(error);
        if (!observer) throw error;
      }
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
      child.once("exit", (code, signal) => {
        if (code === 0 && signal === null) return;
        const outcome = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        fallbackOnce(`PowerShell exited with ${outcome}`);
      });
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
  return (rawTitle: string, rawBody: string, observer?: ActionExecutionObserver): void => {
    const title = sanitizeText(rawTitle);
    const body = sanitizeText(rawBody);

    if (environment.WT_SESSION) {
      spawnWindowsToast(title, body, observer);
      return;
    }

    writeOscSequences(title, body, environment, write);
  };
}
