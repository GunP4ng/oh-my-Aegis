type StartupToastParams = {
    startupToastEnabled: boolean;
    showToast: (args: {
        sessionID: string;
    }) => Promise<boolean>;
    onTopLevelSession: (sessionID: string) => void;
};
export declare function createStartupToastManager(params: StartupToastParams): {
    maybeHandleStartupAnnouncement: (type: string, props: Record<string, unknown>) => {
        handled: boolean;
    };
    maybeScheduleStartupToastFallback: (sessionID: string) => void;
};
export {};
