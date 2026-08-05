import { Logger } from "../core/logger";
import { HostPresentation, PresentationGateway } from "./gateway";

/**
 * Runs the preferred presentation until it says it cannot work, then the fallback for
 * the rest of the session. The switch is one-way on purpose: a mode that failed once
 * because Steam moved is not going to start working before a reload, and retrying it
 * every sync would flicker the library.
 */
export class FallbackPresentation implements PresentationGateway {
  private degraded = false;

  constructor(
    private readonly preferred: PresentationGateway,
    private readonly fallback: PresentationGateway,
    private readonly reason: () => string | null,
    private readonly logger: Logger,
    private readonly announce: (notice: string) => void = () => undefined,
  ) {}

  engage(): void {
    this.check();
    this.active().engage();
  }

  disengage(): void {
    this.preferred.disengage();
    this.fallback.disengage();
  }

  async apply(
    hosts: readonly HostPresentation[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<readonly string[]> {
    const before = this.check();
    const warnings = await this.active().apply(hosts, ownedSteamAppIds);
    return [...before, ...warnings, ...this.check()];
  }

  async remove(): Promise<readonly string[]> {
    // Both, always: whichever one ran, the other's cleanup is a no-op.
    const warnings = [...(await this.preferred.remove()), ...(await this.fallback.remove())];
    return [...new Set(warnings)];
  }

  private active(): PresentationGateway {
    return this.degraded ? this.fallback : this.preferred;
  }

  private check(): string[] {
    const reason = this.reason();
    if (reason === null || this.degraded) {
      return [];
    }
    this.degraded = true;
    this.preferred.disengage();
    this.fallback.engage();
    this.logger.warn(`Falling back to collections: ${reason}`);
    const notice = `Library tabs unavailable (${reason}); using collections instead`;
    this.announce(notice);
    return [notice];
  }
}
