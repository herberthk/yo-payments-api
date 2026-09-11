/**
 * Shared server-side client factory for the Next.js examples.
 *
 * IMPORTANT: this module (like the whole library) is server-only — it uses
 * node:crypto/node:fs and handles API secrets. In your app, add
 * `import "server-only";` at the top of this file (and `npm i server-only`)
 * so Next.js fails the build if it is ever imported from a Client Component.
 * Never expose YO_API_* variables as NEXT_PUBLIC_*.
 */
import { YoAPI } from "@herberthtk/yo-payments-api";
import type { YoMode } from "@herberthtk/yo-payments-api";

export interface YoClientOptions {
    username?: string;
    password?: string;
    mode?: YoMode;
    /** Custom gateway URL (proxies, testing). Defaults to the mode's gateway URL. */
    url?: string;
    /** Custom verification certificate path. Defaults to the bundled Yo! certificate. */
    certFile?: string;
}

/**
 * Create a fresh YoAPI client from server-side environment variables:
 * YO_API_USERNAME, YO_API_PASSWORD, YO_API_MODE ("sandbox" default,
 * "production" for live traffic), plus optional YO_API_URL / YO_PUBLIC_KEY_FILE.
 *
 * Always create one client per request — instances hold per-request state
 * (external references, nonces) and must not be shared across concurrent uses.
 */
export function getYoClient(options: YoClientOptions = {}): YoAPI {
    const username = options.username ?? process.env.YO_API_USERNAME ?? "";
    const password = options.password ?? process.env.YO_API_PASSWORD ?? "";
    const mode: YoMode = options.mode ?? (process.env.YO_API_MODE === "production" ? "production" : "sandbox");

    if (!username || !password) {
        throw new Error("Set the YO_API_USERNAME and YO_API_PASSWORD environment variables.");
    }

    const api = new YoAPI(username, password, mode);

    const url = options.url ?? process.env.YO_API_URL;
    if (url) api.setUrl(url);

    const certFile = options.certFile ?? process.env.YO_PUBLIC_KEY_FILE;
    if (certFile) api.setPublicKeyFileUrl(certFile);

    return api;
}
