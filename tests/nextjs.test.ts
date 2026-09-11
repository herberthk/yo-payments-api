import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPrivateKey, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as ipnPOST } from "../examples/nextjs/app/api/yo/ipn/route.ts";
import { POST as failurePOST } from "../examples/nextjs/app/api/yo/failure/route.ts";
import {
    checkDepositStatus,
    internalTransfer,
    purchaseAirtimestock,
    requestDeposit,
    sendAirtime,
    sendAirtimeInternal,
    withdrawWithKey,
} from "../examples/nextjs/lib/actions.ts";
import { getBalances, getStatement, lookupMsisdn } from "../examples/nextjs/lib/queries.ts";
import { getYoClient } from "../examples/nextjs/lib/yo.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

const ENV_KEYS = [
    "YO_API_USERNAME",
    "YO_API_PASSWORD",
    "YO_API_MODE",
    "YO_API_URL",
    "YO_PUBLIC_KEY_FILE",
    "YO_PRIVATE_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};
let server: any;
let requestBodies: string[] = [];
let responseQueue: { status: number; body: string }[] = [];

function startQueueServer(): string {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            requestBodies.push(await req.text());
            const next = responseQueue.shift() ?? {
                status: 200,
                body: `${XML_HEADER}<Response><Status>OK</Status><StatusCode>200</StatusCode></Response>`,
            };
            return new Response(next.body, { status: next.status, headers: { "Content-Type": "text/xml" } });
        },
    });
    return `http://localhost:${server.port}/task.php`;
}

function queueXml(xml: string, status = 200): void {
    responseQueue.push({ status, body: XML_HEADER + xml });
}

function postForm(fields: Record<string, string>): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost/api/yo/ipn", { method: "POST", body: form });
}

function tempCert(): { certPath: string; privatePem: string } {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const dir = mkdtempSync(join(tmpdir(), "yoapi-nextjs-"));
    const certPath = join(dir, "cert.pem");
    writeFileSync(certPath, publicKey.export({ type: "spki", format: "pem" }));
    return { certPath, privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

function signFields(fields: Record<string, string>, privatePem: string, order: string[], signatureField: string): void {
    const data = order.map((key) => fields[key]).join("");
    fields[signatureField] = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privatePem)).toString(
        "base64",
    );
}

beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    requestBodies = [];
    responseQueue = [];
    process.env.YO_API_USERNAME = "u";
    process.env.YO_API_PASSWORD = "p";
    process.env.YO_API_MODE = "sandbox";
    process.env.YO_API_URL = startQueueServer();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    if (server) {
        server.stop(true);
        server = undefined;
    }
});

describe("nextjs/lib/yo", () => {
    test("builds a client from the environment", () => {
        const api = getYoClient();
        expect(api.getUsername()).toBe("u");
        expect(api.getMode()).toBe("sandbox");
        expect(api.getUrl()).toContain("task.php");
    });

    test("throws without credentials", () => {
        delete process.env.YO_API_USERNAME;
        expect(() => getYoClient()).toThrow("YO_API_USERNAME");
    });
});

describe("nextjs IPN route", () => {
    test("accepts a verified notification", async () => {
        const { certPath, privatePem } = tempCert();
        process.env.YO_PUBLIC_KEY_FILE = certPath;

        const fields: Record<string, string> = {
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "",
        };
        signFields(fields, privatePem, ["date_time", "amount", "narrative", "network_ref", "external_ref", "msisdn"], "signature");

        const res = await ipnPOST(postForm(fields));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("OK");
    });

    test("rejects a tampered notification with 400", async () => {
        const { certPath, privatePem } = tempCert();
        process.env.YO_PUBLIC_KEY_FILE = certPath;

        const fields: Record<string, string> = {
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "",
        };
        signFields(fields, privatePem, ["date_time", "amount", "narrative", "network_ref", "external_ref", "msisdn"], "signature");
        fields.amount = "9999";

        const res = await ipnPOST(postForm(fields));

        expect(res.status).toBe(400);
        expect(await res.text()).toBe("NOT VERIFIED");
    });
});

describe("nextjs failure route", () => {
    test("accepts a verified failure notification", async () => {
        const { certPath, privatePem } = tempCert();
        process.env.YO_PUBLIC_KEY_FILE = certPath;

        const fields: Record<string, string> = {
            failed_transaction_reference: "TRX-FAIL-1",
            transaction_init_date: "2026-09-07 10:00:00",
            verification: "",
        };
        signFields(fields, privatePem, ["failed_transaction_reference", "transaction_init_date"], "verification");

        const res = await failurePOST(postForm(fields));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("OK");
    });
});

describe("nextjs actions", () => {
    test("requestDeposit reports success and failure", async () => {
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>PENDING</TransactionStatus><TransactionReference>TRX-D</TransactionReference></Response>",
        );

        const ok = await requestDeposit("256770000000", 1000, "Reason");
        expect(ok).toEqual({ ok: true, message: "Deposit requested.", reference: "TRX-D" });
        expect(requestBodies[0]).toContain("<Method>acdepositfunds</Method>");

        queueXml(
            "<Response><Status>FAILED</Status><StatusCode>500</StatusCode><StatusMessage>Bad number</StatusMessage>" +
                "<TransactionStatus>FAILED</TransactionStatus></Response>",
        );

        const failed = await requestDeposit("256770000000", 1000, "Reason");
        expect(failed.ok).toBe(false);
        expect(failed.message).toContain("Bad number");
    });

    test("checkDepositStatus returns the gateway status", async () => {
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-D</TransactionReference></Response>",
        );

        const res = await checkDepositStatus("EXT-1");
        expect(res).toEqual({ status: "SUCCEEDED", reference: "TRX-D" });
        expect(requestBodies[0]).toContain("<PrivateTransactionReference>EXT-1</PrivateTransactionReference>");
    });

    test("internalTransfer, airtime and stock purchase actions", async () => {
        const okResponse =
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
            "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-X</TransactionReference></Response>";
        queueXml(okResponse);
        queueXml(okResponse);
        queueXml(okResponse);
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionReference>TRX-S</TransactionReference></Response>",
        );

        const transfer = await internalTransfer({
            currencyCode: "UGX-MTNMM",
            amount: 2000,
            account: 1000123,
            email: "dest@example.com",
            narrative: "Transfer",
        });
        expect(transfer.ok).toBe(true);

        const airtime = await sendAirtime("256770000000", 500, "Gift");
        expect(airtime.ok).toBe(true);

        const airtimeInternal = await sendAirtimeInternal({
            currencyCode: "UGX-MTNAT",
            amount: 300,
            account: 1000456,
            email: "friend@example.com",
            narrative: "Gift",
        });
        expect(airtimeInternal.ok).toBe(true);

        const stock = await purchaseAirtimestock("UGX-MTNAT", 1000);
        expect(stock).toEqual({ ok: true, message: "Airtimestock purchased.", reference: "TRX-S" });
    });

    test("withdrawWithKey signs with key material from the environment", async () => {
        const { privatePem } = tempCert();
        process.env.YO_PRIVATE_KEY = privatePem;
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-W</TransactionReference></Response>",
        );

        const res = await withdrawWithKey("256770000000", 1000, "Payout");

        expect(res).toEqual({ ok: true, message: "Withdrawal completed.", reference: "TRX-W" });
        expect(requestBodies[0]).toContain("<PublicKeyAuthenticationSignatureBase64>");
    });

    test("withdrawWithKey reports missing key configuration", async () => {
        const res = await withdrawWithKey("256770000000", 1000, "Payout");

        expect(res.ok).toBe(false);
        expect(res.message).toContain("YO_PRIVATE_KEY");
    });
});

describe("nextjs queries", () => {
    test("getBalances, getStatement and lookupMsisdn", async () => {
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode>" +
                "<Balance><Currency><Code>UGX</Code><Balance>50000</Balance></Currency></Balance></Response>",
        );
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>0</TotalTransactions>" +
                "<ReturnedTransactions>0</ReturnedTransactions></Response>",
        );
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Found</StatusMessage>" +
                "<AccountInformation><PersonalInformation><Names><FirstName>John</FirstName>" +
                "<Surname>Doe</Surname></Names></PersonalInformation></AccountInformation></Response>",
        );

        expect(await getBalances()).toEqual([{ code: "UGX", balance: "50000" }]);

        const statement = await getStatement({ transactionStatus: "SUCCEEDED" });
        expect(statement.transactions).toEqual([]);
        expect(requestBodies[1]).toContain("<TransactionStatus>SUCCEEDED</TransactionStatus>");

        expect(await lookupMsisdn("256770000000")).toEqual({
            status: "OK",
            firstName: "John",
            middleName: null,
            surname: "Doe",
        });
    });
});
