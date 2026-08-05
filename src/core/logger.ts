export interface Logger {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

const PREFIX = "[Perigee]";

export const consoleLogger: Logger = {
  info: (message, ...details) => console.log(PREFIX, message, ...details),
  warn: (message, ...details) => console.warn(PREFIX, message, ...details),
  error: (message, ...details) => console.error(PREFIX, message, ...details),
};
