export const MOONLIGHT_EXEC_PATH = "/usr/bin/flatpak";
export const MOONLIGHT_FLATPAK_ID = "com.moonlight_stream.Moonlight";

const TAG_PREFIX = "PERIGEE=";
const TAG_PATTERN = /^PERIGEE=([^:\s]+):(\S+) /;
const STREAM_PATTERN = /\sstream (\S+) "((?:[^"\\]|\\.)*)" --quit-after$/;

// Steam substitutes this token with the executable path before splitting the line.
const COMMAND_TOKEN = "%command%";
const CONTROL_CHARACTERS = /\p{Cc}/u;

export interface StreamTarget {
  readonly hostUuid: string;
  readonly hostAppId: string;
  readonly address: string;
  readonly title: string;
  /** Moonlight options, already validated by their descriptors. */
  readonly flags?: readonly string[];
}

export interface OwnershipTag {
  readonly hostUuid: string;
  readonly hostAppId: string;
  readonly hostTitle: string;
  readonly address: string;
}

export class UnrepresentableTargetError extends Error {}

/**
 * Host-supplied text reaches a Steam launch line, so anything that cannot survive
 * quoting is rejected here instead of escaping into the argument list.
 */
export function assertStreamable(target: StreamTarget): void {
  const fields = [
    ["title", target.title],
    ["address", target.address],
  ] as const;
  for (const [field, value] of fields) {
    if (value.length === 0) {
      throw new UnrepresentableTargetError(`empty ${field}`);
    }
    if (CONTROL_CHARACTERS.test(value)) {
      throw new UnrepresentableTargetError(`${field} contains a control character`);
    }
    if (value.includes(COMMAND_TOKEN)) {
      throw new UnrepresentableTargetError(`${field} contains ${COMMAND_TOKEN}`);
    }
  }
  if (/\s/.test(target.address)) {
    throw new UnrepresentableTargetError("address contains whitespace");
  }
}

export function buildLaunchOptions(target: StreamTarget): string {
  assertStreamable(target);
  const tag = `${TAG_PREFIX}${target.hostUuid}:${target.hostAppId}`;
  // Moonlight documents options before the stream verb, which also keeps the
  // identity suffix at the end of the line where parseOwnershipTag anchors it.
  const options = (target.flags ?? []).join(" ");
  const stream =
    `run ${MOONLIGHT_FLATPAK_ID}${options === "" ? "" : ` ${options}`}` +
    ` stream ${target.address} ${quote(target.title)} --quit-after`;
  return `${tag} ${COMMAND_TOKEN} ${stream}`;
}

/**
 * Recover the identity Perigee wrote. The host title is read back from the stream
 * argument, so it survives a rename of the Steam shortcut itself.
 */
export function parseOwnershipTag(launchOptions: string): OwnershipTag | null {
  const tag = TAG_PATTERN.exec(launchOptions);
  const stream = STREAM_PATTERN.exec(launchOptions);
  if (tag === null || stream === null) {
    return null;
  }
  const [, hostUuid, hostAppId] = tag;
  const [, address, quotedTitle] = stream;
  if (
    hostUuid === undefined ||
    hostAppId === undefined ||
    address === undefined ||
    quotedTitle === undefined
  ) {
    return null;
  }
  // Uuids are canonical lowercase; shortcuts written before that was enforced are not.
  return { hostUuid: hostUuid.toLowerCase(), hostAppId, hostTitle: unquote(quotedTitle), address };
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}
