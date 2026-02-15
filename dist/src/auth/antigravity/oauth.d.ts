import type { AntigravityTokenExchangeResult, AntigravityUserInfo } from "./types";
/**
 * PKCE pair containing verifier and challenge.
 */
export interface PKCEPair {
    /** PKCE verifier - used during token exchange */
    verifier: string;
    /** PKCE challenge - sent in auth URL */
    challenge: string;
    /** Challenge method - always "S256" */
    method: string;
}
/**
 * OAuth state encoded in the auth URL.
 * Contains the PKCE verifier for later retrieval.
 */
export interface OAuthState {
    /** PKCE verifier */
    verifier: string;
    /** Optional project ID */
    projectId?: string;
}
/**
 * Result from building an OAuth authorization URL.
 */
export interface AuthorizationResult {
    /** Full OAuth URL to open in browser */
    url: string;
    /** PKCE verifier to use during code exchange */
    verifier: string;
}
/**
 * Result from the OAuth callback server.
 */
export interface CallbackResult {
    /** Authorization code from Google */
    code: string;
    /** State parameter from callback */
    state: string;
    /** Error message if any */
    error?: string;
}
/**
 * Generate PKCE verifier and challenge pair.
 * Uses @openauthjs/openauth for cryptographically secure generation.
 *
 * @returns PKCE pair with verifier, challenge, and method
 */
export declare function generatePKCEPair(): Promise<PKCEPair>;
/**
 * Decode OAuth state from a base64 string.
 *
 * @param encoded - Base64URL or Base64 encoded state
 * @returns Decoded OAuth state
 */
export declare function decodeState(encoded: string): OAuthState;
export declare function buildAuthURL(projectId?: string, clientId?: string, port?: number): Promise<AuthorizationResult>;
/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param verifier - PKCE verifier from initial auth request
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Token exchange result with access and refresh tokens
 */
export declare function exchangeCode(code: string, verifier: string, clientId?: string, clientSecret?: string, port?: number): Promise<AntigravityTokenExchangeResult>;
/**
 * Fetch user info from Google's userinfo API.
 *
 * @param accessToken - Valid access token
 * @returns User info containing email
 */
export declare function fetchUserInfo(accessToken: string): Promise<AntigravityUserInfo>;
export interface CallbackServerHandle {
    port: number;
    waitForCallback: () => Promise<CallbackResult>;
    close: () => void;
}
export declare function startCallbackServer(timeoutMs?: number): CallbackServerHandle;
export declare function performOAuthFlow(projectId?: string, openBrowser?: (url: string) => Promise<void>, clientId?: string, clientSecret?: string): Promise<{
    tokens: AntigravityTokenExchangeResult;
    userInfo: AntigravityUserInfo;
    verifier: string;
}>;
