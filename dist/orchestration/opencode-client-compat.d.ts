type PromptAsyncCallResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
type ConfigProvidersResult = {
    ok: true;
    data: {
        providers: unknown[];
        [key: string]: unknown;
    };
} | {
    ok: false;
    reason: string;
};
export declare function hasSessionPromptAsync(client: unknown): boolean;
export declare function callSessionPromptAsync(client: unknown, attempts: unknown[]): Promise<PromptAsyncCallResult>;
export declare function callConfigProviders(client: unknown, directory: string): Promise<ConfigProvidersResult>;
export {};
