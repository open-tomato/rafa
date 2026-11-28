/**
 * The `rafa-hub health` command, which `bin.ts` routes here and the
 * image's `HEALTHCHECK` runs: {@link runHealth} reads the hub's config
 * through `readHubConfig` (`config-file.ts`), the reader the serve start
 * uses, and asks `GET /health` of the hub on this machine,
 * `http://127.0.0.1:<hub.port>/health` (#1659).
 *
 * ## What it answers
 *
 * Exit 0 when the hub answers `200`, printing nothing, since the image
 * runs it every 30 seconds. Exit 1 otherwise, with one line on standard
 * error naming the cause, so the container's health log says why:
 *
 *   - the config refused, with every problem the reader names;
 *   - the hub not reached (the connection refused, or no answer within
 *     {@link HEALTH_TIMEOUT_MS}), naming the URL and the error;
 *   - a status other than `200`, such as the `503` a hub answers while
 *     its store is not open, naming the URL and the status.
 *
 * It reads the config as `rafa-hub install` does, so it prints none of
 * the serve start's warnings, a YAML file's included. A redirect is not
 * followed: only the hub's own `200` is health.
 *
 * The hub listens on every interface unless told otherwise, so
 * `127.0.0.1` reaches it from inside its container; the host is fixed,
 * since the config names no hostname.
 *
 * {@link runHealth} is the whole command but the process's exit, so a
 * test runs it in process; importing this file starts nothing.
 */
import { readHubConfig } from './config-file.js';
import { HubConfigError } from './config.js';

/** The word that runs `rafa-hub health`. */
export const HEALTH_WORD = 'health';

/** What `rafa-hub health` takes, as a refused argument list says it. */
export const HEALTH_USAGE = 'rafa-hub health';

/** The host `rafa-hub health` asks: the hub on this machine. */
export const HEALTH_HOST = '127.0.0.1';

/** How long `rafa-hub health` waits for the hub's answer before it reads as not reached. */
export const HEALTH_TIMEOUT_MS = 5000;

/** The prefix every line of `rafa-hub health` opens with. */
const HEALTH_PREFIX = 'rafa-hub health';

/** The status a healthy hub answers. */
const HEALTHY_STATUS = 200;

/** What {@link runHealth} may vary beyond the environment. */
export interface RunHealthOptions {
  /** Where the line naming a failure goes; standard error when left out. */
  readonly err?: (line: string) => void;
  /** How long to wait for the hub's answer; {@link HEALTH_TIMEOUT_MS} when left out. */
  readonly timeoutMs?: number;
}

/** The message of a thrown value, on one line. */
function oneLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.replace(/\s*\n\s*/g, '; ');
}

/** The URL `rafa-hub health` asks of a hub listening on `port`. */
export function healthUrl(port: number): string {
  return `http://${HEALTH_HOST}:${String(port)}/health`;
}

/** Whether `args` (the arguments past `health`) are the ones `rafa-hub health` takes: none. */
export function isHealthCommand(args: readonly string[]): boolean {
  return args.length === 0;
}

/**
 * Runs `rafa-hub health`: reads the config `env`'s `RAFA_HUB_CONFIG`
 * names and asks `/health` of the hub at `127.0.0.1` on its `hub.port`,
 * answering 0 on `200` with nothing printed, or 1 with one line on `err`
 * naming the refused config, the hub not reached, or the status it
 * answered. Never exits the process.
 */
export async function runHealth(env: Readonly<Record<string, string | undefined>>, options: RunHealthOptions = {}): Promise<number> {
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  let port: number;
  try {
    ({ config: { port } } = await readHubConfig(env));
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;

    err(`${HEALTH_PREFIX}: the config was refused: ${error.problems.join('; ')}`);
    return 1;
  }

  const url = healthUrl(port);
  let status: number;
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? HEALTH_TIMEOUT_MS) });
    status = response.status;
    await response.body?.cancel();
  } catch (error) {
    err(`${HEALTH_PREFIX}: the hub at ${url} was not reached: ${oneLine(error)}`);
    return 1;
  }
  if (status === HEALTHY_STATUS) return 0;

  err(`${HEALTH_PREFIX}: the hub at ${url} answered ${String(status)}, expected ${String(HEALTHY_STATUS)}`);
  return 1;
}
