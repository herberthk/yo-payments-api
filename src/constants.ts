import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { YoMode } from "./types.ts";
import { YO_UGANDA_PRODUCTION_CERTIFICATE, YO_UGANDA_SANDBOX_CERTIFICATE } from "./embeddedCerts.ts";

export const SANDBOX_URL = "https://sandbox.yo.co.ug/services/yopaymentsdev/task.php";
export const PRODUCTION_URL = "https://paymentsapi1.yo.co.ug/ybs/task.php";

export const PUBLIC_KEY_FILE_FOR_SANDBOX = "Yo_Uganda_Public_Sandbox_Certificate.crt";
export const PUBLIC_KEY_FILE_FOR_PRODUCTION = "Yo_Uganda_Public_Certificate.crt";

/** Default cap for gateway response bodies (real responses are a few KB). */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const MODULE_DIR = resolveModuleDir();
export const CERTS_DIR = join(MODULE_DIR, "..", "certs");

/**
 * Resolve the directory of this module. Bundled outputs (e.g. CJS builds,
 * Next.js server bundles) may not support import.meta.url — fall back to the
 * process working directory instead of crashing at import time.
 */
function resolveModuleDir(): string {
    try {
        const metaUrl = import.meta?.url;
        if (typeof metaUrl === "string" && metaUrl.length > 0) {
            return dirname(fileURLToPath(metaUrl));
        }
    } catch {
        // ignore — use the fallback below
    }
    return process.cwd();
}

/**
 * Embedded verification certificate for the given mode. Used as a fallback
 * when the cert files in certs/ cannot be resolved at runtime.
 */
export function defaultVerificationCertificate(mode: YoMode): string {
    return mode === "sandbox" ? YO_UGANDA_SANDBOX_CERTIFICATE : YO_UGANDA_PRODUCTION_CERTIFICATE;
}
