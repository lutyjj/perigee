import { useCallback, useState } from "react";

import { PanelSession } from "../core/panel-session";

/** Component state that writes through to the session, so a remount reads it back. */
export function useSessionState<Key extends keyof PanelSession>(
  session: PanelSession,
  key: Key,
): [PanelSession[Key], (value: PanelSession[Key]) => void] {
  const [value, setValue] = useState<PanelSession[Key]>(session[key]);
  const write = useCallback(
    (next: PanelSession[Key]) => {
      session[key] = next;
      setValue(next);
    },
    [session, key],
  );
  return [value, write];
}
