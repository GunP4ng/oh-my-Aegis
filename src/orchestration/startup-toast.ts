type StartupEventInfo = {
  id?: string;
  parentID?: string;
};

type StartupToastParams = {
  startupToastEnabled: boolean;
  showToast: (args: { sessionID: string }) => Promise<boolean>;
  onTopLevelSession: (sessionID: string) => void;
};

export function createStartupToastManager(params: StartupToastParams) {
  const startupToastShownBySession = new Set<string>();
  const startupToastPendingBySession = new Set<string>();
  const topLevelSessionIDs = new Set<string>();
  const startupToastFallbackCheckedBySession = new Set<string>();

  const maybeShowStartupToast = async (sessionID: string): Promise<void> => {
    if (!params.startupToastEnabled) {
      return;
    }
    if (!sessionID || startupToastShownBySession.has(sessionID) || startupToastPendingBySession.has(sessionID)) {
      return;
    }

    startupToastPendingBySession.add(sessionID);
    try {
      const shown = await params.showToast({ sessionID });
      if (shown) {
        startupToastShownBySession.add(sessionID);
      }
    } finally {
      startupToastPendingBySession.delete(sessionID);
    }
  };

  const scheduleStartupToast = (sessionID: string): void => {
    setTimeout(() => {
      void maybeShowStartupToast(sessionID);
    }, 0);
  };

  const maybeScheduleStartupToastFallback = (sessionID: string): void => {
    if (!sessionID || !topLevelSessionIDs.has(sessionID)) {
      return;
    }
    if (startupToastFallbackCheckedBySession.has(sessionID)) {
      return;
    }
    if (startupToastShownBySession.has(sessionID) || startupToastPendingBySession.has(sessionID)) {
      return;
    }
    startupToastFallbackCheckedBySession.add(sessionID);
    scheduleStartupToast(sessionID);
  };

  const maybeHandleStartupAnnouncement = (
    type: string,
    props: Record<string, unknown>,
  ): { handled: boolean } => {
    if (type !== "session.created" && type !== "session.updated") {
      return { handled: false };
    }
    const info = (
      props.info && typeof props.info === "object"
        ? (props.info as StartupEventInfo)
        : props.session && typeof props.session === "object"
          ? (props.session as StartupEventInfo)
          : undefined
    );
    const sessionID =
      typeof info?.id === "string"
        ? info.id
        : typeof props.sessionID === "string"
          ? props.sessionID
          : "";
    const parentID = typeof info?.parentID === "string" ? info.parentID : "";
    if (sessionID && !parentID) {
      topLevelSessionIDs.add(sessionID);
      params.onTopLevelSession(sessionID);
      scheduleStartupToast(sessionID);
    }
    return { handled: type === "session.created" };
  };

  return {
    maybeHandleStartupAnnouncement,
    maybeScheduleStartupToastFallback,
  };
}
