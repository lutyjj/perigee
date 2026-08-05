// The boundary guards every hand-written schema mirror needs. Each mirror binds them
// to its own error type once, so the mirrors differ only in what they describe.

export type FormatError = new (message: string) => Error;

export interface Reader {
  record(value: unknown, what: string): Record<string, unknown>;
  list(value: unknown, what: string): unknown[];
  number(value: unknown, what: string): number;
  text(value: unknown, what: string): string;
}

export function reader(error: FormatError): Reader {
  const fail = (message: string): never => {
    throw new error(message);
  };
  return {
    record: (value, what) =>
      typeof value !== "object" || value === null || Array.isArray(value)
        ? fail(`Expected an object for ${what}`)
        : (value as Record<string, unknown>),
    list: (value, what) => (Array.isArray(value) ? value : fail(`Expected an array for ${what}`)),
    number: (value, what) =>
      typeof value === "number" && Number.isFinite(value)
        ? value
        : fail(`Expected a number for ${what}`),
    text: (value, what) =>
      typeof value === "string" ? value : fail(`Expected a string for ${what}`),
  };
}
