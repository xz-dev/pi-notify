export interface BelLauncherOptions {
  write?: (value: string) => unknown;
}

/** Emit one standard terminal BEL control character. */
export function createBelLauncher(options: BelLauncherOptions = {}): () => void {
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  return () => {
    write("\x07");
  };
}
