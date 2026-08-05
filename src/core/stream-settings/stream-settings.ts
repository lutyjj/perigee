import {
  StreamSettingDescriptor,
  StreamSettingValue,
  StreamSettings,
  accepts,
  flagsFor,
} from "./descriptor";

export interface ValidationResult {
  readonly values: StreamSettings;
  readonly rejected: readonly string[];
}

/**
 * Keep only what the registry recognises and accepts. Stored values outlive the
 * registry that wrote them, so a removed setting or a narrowed range must drop out
 * here rather than reach a launch line.
 */
export function validate(
  descriptors: readonly StreamSettingDescriptor[],
  stored: Readonly<Record<string, unknown>>,
): ValidationResult {
  const byKey = new Map(descriptors.map((descriptor) => [descriptor.key, descriptor]));
  const values: Record<string, StreamSettingValue> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(stored)) {
    const descriptor = byKey.get(key);
    if (descriptor === undefined || !isSettingValue(value) || !accepts(descriptor, value)) {
      rejected.push(key);
      continue;
    }
    values[key] = value;
  }
  return { values, rejected };
}

/** The flags a converged shortcut carries, in registry order so the line is stable. */
export function streamFlags(
  descriptors: readonly StreamSettingDescriptor[],
  stored: Readonly<Record<string, unknown>>,
): string[] {
  const { values } = validate(descriptors, stored);
  return descriptors.flatMap((descriptor) => flagsFor(descriptor, values[descriptor.key]));
}

/**
 * Whether a setting's declared requirement holds. Moonlight itself only lets frame
 * pacing be chosen while V-Sync is on; the rule lives on the descriptor so the next
 * dependent setting is one more registry entry.
 */
export function requirementMet(
  descriptor: StreamSettingDescriptor,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const requirement = descriptor.requires;
  return requirement === undefined || values[requirement.key] === requirement.value;
}

export function requirementLabel(
  descriptor: StreamSettingDescriptor,
  descriptors: readonly StreamSettingDescriptor[],
): string | null {
  const requirement = descriptor.requires;
  if (requirement === undefined) {
    return null;
  }
  const owner = descriptors.find((candidate) => candidate.key === requirement.key);
  return `Requires ${owner?.label ?? requirement.key}`;
}

export interface SettingGroup {
  readonly group: string;
  readonly settings: readonly StreamSettingDescriptor[];
}

/**
 * The panel's micro-groups, partitioned from the registry. Both the groups and the
 * settings inside them keep registry order, so a new group is one more string in one
 * descriptor and the renderer never learns a name.
 */
export function groups(
  descriptors: readonly StreamSettingDescriptor[],
): SettingGroup[] {
  const grouped: SettingGroup[] = [];
  for (const descriptor of descriptors) {
    const existing = grouped.find((entry) => entry.group === descriptor.group);
    if (existing === undefined) {
      grouped.push({ group: descriptor.group, settings: [descriptor] });
    } else {
      (existing.settings as StreamSettingDescriptor[]).push(descriptor);
    }
  }
  return grouped;
}

function isSettingValue(value: unknown): value is StreamSettingValue {
  return typeof value === "string" || typeof value === "number";
}
