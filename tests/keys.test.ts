import { describe, expect, test } from "bun:test";
import {
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    sign as rsaSign,
    verify as rsaVerify,
} from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YO_UGANDA_PRODUCTION_CERTIFICATE } from "../src/embeddedCerts.ts";
import { loadPublicKeyCached } from "../src/keys.ts";

function tempKeyPair(): { pubPath: string; pubPem: string; privPem: string } {
    const dir = mkdtempSync(join(tmpdir(), "yoapi-keys-"));
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const pubPath = join(dir, "public.pem");
    writeFileSync(pubPath, pubPem);
    return { pubPath, pubPem, privPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

describe("loadPublicKeyCached", () => {
    test("loads a key from file and returns the cached instance on repeat calls", () => {
        const { pubPath } = tempKeyPair();

        const first = loadPublicKeyCached(pubPath);
        expect(first).not.toBeNull();

        const second = loadPublicKeyCached(pubPath);
        expect(second).toBe(first);
    });

    test("reloads when the file contents change", () => {
        const firstKeys = tempKeyPair();
        const secondKeys = tempKeyPair();

        const before = loadPublicKeyCached(firstKeys.pubPath);
        writeFileSync(firstKeys.pubPath, secondKeys.pubPem);

        const after = loadPublicKeyCached(firstKeys.pubPath);
        expect(after).not.toBeNull();
        expect(after).not.toBe(before);
    });

    test("returns null for missing files without a fallback", () => {
        expect(loadPublicKeyCached(join(tmpdir(), "missing-key.pem"))).toBeNull();
    });

    test("returns null for invalid keys without a fallback", () => {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-keys-"));
        const badPath = join(dir, "bad.pem");
        writeFileSync(badPath, "not a key");

        expect(loadPublicKeyCached(badPath)).toBeNull();
    });

    test("uses the fallback when the file is missing or invalid", () => {
        const { pubPem, privPem } = tempKeyPair();
        const dir = mkdtempSync(join(tmpdir(), "yoapi-keys-"));
        const badPath = join(dir, "bad.pem");
        writeFileSync(badPath, "not a key");

        for (const path of [join(tmpdir(), "missing-key.pem"), badPath]) {
            const key = loadPublicKeyCached(path, pubPem);
            expect(key).not.toBeNull();

            // Prove it is the fallback key by verifying a signature made with its pair.
            const data = "fallback-check";
            const signature = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privPem));
            expect(rsaVerify("sha256", Buffer.from(data, "utf-8"), key!, signature)).toBe(true);
        }
    });

    test("returns null when both file and fallback are invalid", () => {
        expect(loadPublicKeyCached(join(tmpdir(), "missing-key.pem"), "junk")).toBeNull();
    });

    test("loads the embedded production certificate", () => {
        const key = loadPublicKeyCached(join(tmpdir(), "missing-key.pem"), YO_UGANDA_PRODUCTION_CERTIFICATE);
        expect(key).not.toBeNull();
        expect(() => createPublicKey(YO_UGANDA_PRODUCTION_CERTIFICATE)).not.toThrow();
    });
});
