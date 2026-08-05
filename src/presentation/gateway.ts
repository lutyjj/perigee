/**
 * How a host's shortcuts are surfaced in the library. Perigee always creates the
 * shortcuts; a presentation decides what, if anything, groups them.
 */
export interface HostPresentation {
  readonly hostUuid: string;
  readonly hostName: string;
  readonly steamAppIds: readonly number[];
}

export interface PresentationGateway {
  /**
   * Start doing whatever this mode needs to stay visible. Called once when the mode
   * becomes active, at plugin load rather than at the first sync: a mode that only
   * takes effect while something else is running is a mode that looks broken.
   */
  engage(): void;

  /** Stop, without giving back what was already created. The pair of engage. */
  disengage(): void;

  /** Bring the grouping in line with the hosts that just converged. */
  apply(
    hosts: readonly HostPresentation[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<readonly string[]>;

  /**
   * Give back everything this presentation created. Part of the abandon edge, so it
   * must not depend on the current hosts: a purge has to clean up after hosts that
   * are offline, unpaired or renamed since the grouping was made.
   */
  remove(): Promise<readonly string[]>;
}
