import { spawn } from "node:child_process";

interface OscLauncherOptions {
  environment?: NodeJS.ProcessEnv;
  write?: (value: string) => void;
  spawnWindowsToast?: (title: string, body: string) => void;
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

function launchWindowsToast(title: string, body: string, warn: (message: string) => void): void {
  const encodedCommand = Buffer.from(windowsToastScript(title, body), "utf16le").toString("base64");
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => warn(`Cannot launch Windows notification: ${error.message}`));
    child.unref();
  } catch (error) {
    warn(`Cannot launch Windows notification: ${String(error)}`);
  }
}

export function createOscLauncher(options: OscLauncherOptions) {
  const environment = options.environment ?? process.env;
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const spawnWindowsToast = options.spawnWindowsToast ?? ((title, body) => launchWindowsToast(title, body, options.warn));

  return (rawTitle: string, rawBody: string): void => {
    const title = safeText(rawTitle);
    const body = safeText(rawBody);

    try {
      if (environment.WT_SESSION) {
        spawnWindowsToast(title, body);
        return;
      }

      const sequences = environment.KITTY_WINDOW_ID
        ? [`\x1b]99;i=pi-notify:d=0;${title}\x1b\\`, `\x1b]99;i=pi-notify:p=body;${body}\x1b\\`]
        : environment.TERM_PROGRAM === "iTerm.app" || environment.ITERM_SESSION_ID
          ? [`\x1b]9;${title}: ${body}\x07`]
          : [`\x1b]777;notify;${title};${body}\x07`];
      for (const sequence of sequences) write(tmuxPassthrough(sequence, environment));
    } catch (error) {
      options.warn(`Cannot launch terminal notification: ${String(error)}`);
    }
  };
}
