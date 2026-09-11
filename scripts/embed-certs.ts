/**
 * Regenerates src/embeddedCerts.ts from certs/*.crt.
 *
 * The embedded certificates are a fallback so IPN verification keeps working
 * when the cert files cannot be resolved at runtime (bundled Next.js servers,
 * CJS builds where import.meta.url is unavailable, relocated installs).
 * File-based certificates always take precedence when readable.
 *
 * Run with: bun run embed-certs (also runs automatically before builds).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CERT_FILES = {
    sandbox: "Yo_Uganda_Public_Sandbox_Certificate.crt",
    production: "Yo_Uganda_Public_Certificate.crt",
} as const;

type CertMode = keyof typeof CERT_FILES;

function constName(mode: CertMode): string {
    return mode === "sandbox" ? "YO_UGANDA_SANDBOX_CERTIFICATE" : "YO_UGANDA_PRODUCTION_CERTIFICATE";
}

const entries = (Object.keys(CERT_FILES) as CertMode[]).map((mode) => {
    const pem = readFileSync(join(ROOT, "certs", CERT_FILES[mode]), "utf-8");
    if (!pem.includes("BEGIN CERTIFICATE")) {
        throw new Error(`Expected a PEM certificate in certs/${CERT_FILES[mode]}`);
    }
    return `export const ${constName(mode)} = ${JSON.stringify(pem)};`;
});

writeFileSync(
    join(ROOT, "src", "embeddedCerts.ts"),
    `// AUTO-GENERATED from certs/*.crt — do not edit by hand.\n// Regenerate with: bun run embed-certs\n\n${entries.join("\n\n")}\n`,
);

console.log("Wrote src/embeddedCerts.ts");
