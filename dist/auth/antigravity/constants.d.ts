/**
 * Antigravity OAuth configuration constants.
 * Values sourced from cliproxyapi/sdk/auth/antigravity.go
 *
 * ## Logging Policy
 *
 * All console logging in antigravity modules follows a consistent policy:
 *
 * - **Debug logs**: Guard with `if (process.env.ANTIGRAVITY_DEBUG === "1")`
 *   - Includes: info messages, warnings, non-fatal errors
 *   - Enable debugging: `ANTIGRAVITY_DEBUG=1 opencode`
 *
 * - **Fatal errors**: None currently. All errors are handled by returning
 *   appropriate error responses to OpenCode's auth system.
 *
 * This policy ensures production silence while enabling verbose debugging
 * when needed for troubleshooting OAuth flows.
 */
export declare const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export declare const ANTIGRAVITY_CLIENT_SECRET = "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";
export declare const ANTIGRAVITY_CALLBACK_PORT = 51121;
export declare const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
export declare const ANTIGRAVITY_SCOPES: readonly ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/cclog", "https://www.googleapis.com/auth/experimentsandconfigs"];
export declare const ANTIGRAVITY_ENDPOINT_FALLBACKS: readonly ["https://daily-cloudcode-pa.sandbox.googleapis.com", "https://autopush-cloudcode-pa.sandbox.googleapis.com", "https://cloudcode-pa.googleapis.com"];
export declare const ANTIGRAVITY_API_VERSION = "v1internal";
export declare const ANTIGRAVITY_HEADERS: {
    readonly "User-Agent": "google-api-nodejs-client/9.15.1";
    readonly "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1";
    readonly "Client-Metadata": string;
};
export declare const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";
export declare const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export declare const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export declare const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
export declare const ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS = 60000;
export declare const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";
