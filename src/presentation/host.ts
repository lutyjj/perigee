import { Logger } from "../core/logger";
import { PresentationGateway } from "./gateway";
import { PresentationMode } from "./modes";

export type GatewayBuilder = (
  mode: PresentationMode,
  announce: (notice: string) => void,
) => PresentationGateway;

export type ModeWriter = (mode: PresentationMode) => Promise<void>;

/**
 * Owns the active presentation for the plugin's lifetime, not the panel's.
 *
 * A mode that only engages while the quick-access panel happens to be open, or only
 * during a sync, is a mode the user sees as broken. The host is created once at plugin
 * load, engages the stored mode immediately, and outlives every panel mount. It is
 * also where a mode's own complaints surface, so a fallback names itself without
 * waiting for someone to press Sync.
 */
export class PresentationHost {
  private gateway: PresentationGateway;
  private notice: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly build: GatewayBuilder,
    private mode: PresentationMode,
    private readonly logger: Logger,
  ) {
    this.gateway = this.build(mode, (notice) => this.report(notice));
    this.gateway.engage();
  }

  current(): PresentationGateway {
    return this.gateway;
  }

  currentMode(): PresentationMode {
    return this.mode;
  }

  currentNotice(): string | null {
    return this.notice;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Store the choice first, then swap. Cleaning up the old grouping is Steam work
   * that can fail or hang, and the user's setting must not be hostage to it.
   */
  async switchTo(mode: PresentationMode, write: ModeWriter): Promise<readonly string[]> {
    if (mode === this.mode) {
      return [];
    }
    await write(mode);
    const previous = this.gateway;
    this.mode = mode;
    this.notice = null;
    this.gateway = this.build(mode, (notice) => this.report(notice));
    previous.disengage();
    this.gateway.engage();
    this.announce();

    try {
      return await previous.remove();
    } catch (error) {
      this.logger.warn("Could not clear the previous grouping", error);
      return ["The previous grouping could not be cleared"];
    }
  }

  dismount(): void {
    this.gateway.disengage();
    this.listeners.clear();
  }

  private report(notice: string): void {
    this.notice = notice;
    this.announce();
  }

  private announce(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
