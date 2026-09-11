import { YoAPI } from "../index.ts";
import type { YoMode } from "../index.ts";

/**
 * Build a YoAPI client from environment variables (mirrors the `$username`,
 * `$password`, `$mode` variables at the top of the PHP examples):
 *
 * - YO_API_USERNAME (required)
 * - YO_API_PASSWORD (required)
 * - YO_API_MODE ("sandbox" by default; set to "production" for live traffic)
 */
export function createClientFromEnv(): YoAPI {
    const username = process.env.YO_API_USERNAME ?? "";
    const password = process.env.YO_API_PASSWORD ?? "";
    const mode: YoMode = process.env.YO_API_MODE === "production" ? "production" : "sandbox";

    if (!username || !password) {
        throw new Error(
            "Set the YO_API_USERNAME and YO_API_PASSWORD environment variables to your Yo! Payments credentials.",
        );
    }

    return new YoAPI(username, password, mode);
}

/**
 * Create a unique transaction reference, mirroring PHP's
 * `date("YmdHis").rand(1,100)` used in the examples.
 */
export function uniqueReference(): string {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${stamp}${1 + Math.floor(Math.random() * 100)}`;
}

/** Sleep helper (mirrors PHP's `sleep()`; takes milliseconds). */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
