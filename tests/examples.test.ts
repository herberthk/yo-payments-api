import { afterEach, describe, expect, test } from "bun:test";
import { createPrivateKey, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YoAPI } from "../index.ts";
import { depositFunds } from "../examples/deposit_funds.ts";
import { checkTransaction, depositFundsNonBlocking } from "../examples/deposit_funds_nonblocking.ts";
import { fetchMinistatement, getMinistatementExamples } from "../examples/get_ministatement.ts";
import { withdrawWithPublicKeyAuth } from "../examples/withdraw_funds_public_key_authentication.ts";
import { handlePaymentNotification } from "../examples/receive_payment_notification.ts";
import { handlePaymentFailureNotification } from "../examples/receive_payment_failure_notification.ts";
import { createClientFromEnv, uniqueReference } from "../examples/shared.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

let server: any;
let requestBodies: string[] = [];
let responseQueue: { status: number; body: string }[] = [];

afterEach(() => {
    requestBodies = [];
    responseQueue = [];
    if (server) {
        server.stop(true);
        server = undefined;
    }
});

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

function makeExampleClient(): YoAPI {
    const api = new YoAPI("exampleuser", "examplepass", "sandbox");
    api.setUrl(startQueueServer());
    return api;
}

function queueXml(xml: string, status = 200): void {
    responseQueue.push({ status, body: XML_HEADER + xml });
}

function externalReferenceOf(body: string): string | undefined {
    return body.match(/<ExternalReference>(.*?)<\/ExternalReference>/)?.[1];
}

describe("examples/shared", () => {
    test("uniqueReference matches the PHP date()+rand() shape", () => {
        expect(uniqueReference()).toMatch(/^\d{14}\d{1,3}$/);
        expect(uniqueReference()).toMatch(/^\d{14}\d{1,3}$/);
    });

    test("createClientFromEnv reads credentials and mode", () => {
        const savedUser = process.env.YO_API_USERNAME;
        const savedPass = process.env.YO_API_PASSWORD;
        const savedMode = process.env.YO_API_MODE;
        try {
            process.env.YO_API_USERNAME = "u";
            process.env.YO_API_PASSWORD = "p";
            process.env.YO_API_MODE = "production";
            const api = createClientFromEnv();
            expect(api.getUsername()).toBe("u");
            expect(api.getMode()).toBe("production");

            delete process.env.YO_API_USERNAME;
            expect(() => createClientFromEnv()).toThrow("YO_API_USERNAME");
        } finally {
            if (savedUser !== undefined) process.env.YO_API_USERNAME = savedUser;
            else delete process.env.YO_API_USERNAME;
            if (savedPass !== undefined) process.env.YO_API_PASSWORD = savedPass;
            else delete process.env.YO_API_PASSWORD;
            if (savedMode !== undefined) process.env.YO_API_MODE = savedMode;
            else delete process.env.YO_API_MODE;
        }
    });
});

describe("examples/deposit_funds", () => {
    test("reports success with the transaction reference", async () => {
        const api = makeExampleClient();
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-EX-1</TransactionReference></Response>",
        );

        const message = await depositFunds(api, "256770000000", 1000, "Reason for transfer of funds");

        expect(message).toContain("Payment made!");
        expect(message).toContain("TRX-EX-1");
        expect(externalReferenceOf(requestBodies[0]!)).toMatch(/^\d+$/);
    });

    test("reports gateway errors", async () => {
        const api = makeExampleClient();
        queueXml(
            "<Response><Status>FAILED</Status><StatusCode>500</StatusCode><StatusMessage>Bad number</StatusMessage>" +
                "<TransactionStatus>FAILED</TransactionStatus></Response>",
        );

        const message = await depositFunds(api);

        expect(message).toBe("Yo Payments Error: Bad number");
    });
});

describe("examples/deposit_funds_nonblocking", () => {
    test("waits, checks status by external reference, and reports", async () => {
        const api = makeExampleClient();
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Pending</StatusMessage>" +
                "<TransactionStatus>PENDING</TransactionStatus><TransactionReference>TRX-NB</TransactionReference></Response>",
        );
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus></Response>",
        );

        const message = await depositFundsNonBlocking(api, { waitMs: 0 });

        expect(message).toContain("Transaction was successful");
        expect(message).toContain("TRX-NB");

        // The follow-up status check must reference the deposit's external reference.
        const sentRef = externalReferenceOf(requestBodies[0]!);
        expect(sentRef).toBeDefined();
        expect(requestBodies[1]).toContain(`<PrivateTransactionReference>${sentRef}</PrivateTransactionReference>`);
        expect(requestBodies[0]).toContain("<NonBlocking>TRUE</NonBlocking>");
        expect(requestBodies[0]).toContain("<InstantNotificationUrl>example.com/ipn.php</InstantNotificationUrl>");
        expect(requestBodies[0]).toContain("<FailureNotificationUrl>example.com/fpn.php</FailureNotificationUrl>");
    });

    test("reports a still-pending transaction", async () => {
        const api = makeExampleClient();
        queueXml("<Response><Status>OK</Status><StatusCode>200</StatusCode><TransactionStatus>PENDING</TransactionStatus></Response>");

        const message = await checkTransaction(api, "EXT-1");

        expect(message).toBe("Transaction is still in PENDING state.");
    });
});

describe("examples/get_ministatement", () => {
    test("runs the three PHP example queries", async () => {
        const api = makeExampleClient();
        const tx =
            "<Transaction><TransactionSystemId>SYS-1</TransactionSystemId>" +
            "<TransactionReference>TRX-1</TransactionReference><TransactionStatus>SUCCEEDED</TransactionStatus>" +
            "<InitiationDate>2017-10-26 10:00:00</InitiationDate><CompletionDate>2017-10-26 10:01:00</CompletionDate>" +
            "<NarrativeBase64>SGVsbG8=</NarrativeBase64><Currency>UGX-MTNMM</Currency><Amount>100</Amount>" +
            "<Balance>900</Balance><GeneralType>DEPOSIT</GeneralType><DetailedType>MOBILE_MONEY_DEPOSIT</DetailedType>" +
            "<BeneficiaryBase64>Qg==</BeneficiaryBase64><SenderBase64>Uw==</SenderBase64>" +
            "<TransactionEntryDesignation>TRANSACTION</TransactionEntryDesignation></Transaction>";
        const ok = (inner: string): string =>
            `<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>1</TotalTransactions>` +
            `<ReturnedTransactions>1</ReturnedTransactions><Transactions>${inner}</Transactions></Response>`;
        queueXml(ok(tx));
        queueXml(ok(tx));
        queueXml(ok(tx));

        const statements = await getMinistatementExamples(api);

        expect(statements).toHaveLength(3);
        expect(statements[0]).toContain("TRX-1");
        expect(requestBodies[0]).toContain("<CurrencyCode>UGX-MTNMM</CurrencyCode>");
        expect(requestBodies[1]).toContain("<CurrencyCode>UGX-WARIDMM</CurrencyCode>");
        expect(requestBodies[2]).not.toContain("StartDate");
    });

    test("formats gateway errors", async () => {
        const api = makeExampleClient();
        queueXml("<Response><Status>FAILED</Status><StatusCode>500</StatusCode><ErrorMessage>Denied</ErrorMessage></Response>");

        const message = await fetchMinistatement(api, {
            startDate: null,
            endDate: null,
            transactionStatus: null,
            currencyCode: null,
            resultSetLimit: null,
        });

        expect(message).toBe("Yo Payments Error: Denied");
    });
});

describe("examples/withdraw_funds_public_key_authentication", () => {
    function tempPrivateKey(): string {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-example-"));
        const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const keyPath = join(dir, "private.pem");
        writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
        return keyPath;
    }

    test("withdraws with a generated auth signature", async () => {
        const api = makeExampleClient();
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-WD</TransactionReference></Response>",
        );

        const message = await withdrawWithPublicKeyAuth(api, {
            msisdn: "256770000000",
            amount: "1000",
            narrative: "payout",
            privateKeyFile: tempPrivateKey(),
        });

        expect(message).toContain("Payment made!");
        expect(message).toContain("TRX-WD");
        expect(requestBodies[0]).toContain("<PublicKeyAuthenticationNonce>");
        expect(requestBodies[0]).toContain("<PublicKeyAuthenticationSignatureBase64>");
        expect(api.getPublicKeyAuthenticationSignatureBase64()).not.toBeNull();
    });

    test("reports unsuccessful withdrawals", async () => {
        const api = makeExampleClient();
        queueXml(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>No funds</StatusMessage>" +
                "<TransactionStatus>FAILED</TransactionStatus></Response>",
        );

        const message = await withdrawWithPublicKeyAuth(api, {
            msisdn: "256770000000",
            amount: "1000",
            narrative: "payout",
            privateKeyFile: tempPrivateKey(),
        });

        expect(message).toBe("Yo Payments Error: No funds");
    });

    test("catches key errors like the PHP try/catch", async () => {
        const api = makeExampleClient();

        const message = await withdrawWithPublicKeyAuth(api, {
            msisdn: "256770000000",
            amount: "1000",
            narrative: "payout",
            privateKeyFile: join(tmpdir(), "missing-example-key.pem"),
        });

        expect(message).toContain("Caught exception: Private key file could not be opened.");
    });
});

describe("examples/receive_payment_notification", () => {
    function signedForm(): { api: YoAPI; form: Record<string, string> } {
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const dir = mkdtempSync(join(tmpdir(), "yoapi-example-"));
        const certPath = join(dir, "cert.pem");
        writeFileSync(certPath, publicKey.export({ type: "spki", format: "pem" }));

        const api = new YoAPI("u", "p", "sandbox");
        api.setPublicKeyFileUrl(certPath);

        const form = {
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "",
        };
        const data = form.date_time + form.amount + form.narrative + form.network_ref + form.external_ref + form.msisdn;
        form.signature = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }) as string)).toString("base64");
        return { api, form };
    }

    test("prints verified payment details", () => {
        const { api, form } = signedForm();

        const message = handlePaymentNotification(api, form);

        expect(message).toContain("MSISDN: 256770000000");
        expect(message).toContain("AMOUNT: 1000");
        expect(message).toContain("EXTERNAL REFERENCE: EXT-1");
    });

    test("prints nothing for unverified notifications", () => {
        const { api, form } = signedForm();

        expect(handlePaymentNotification(api, { ...form, amount: "2" })).toBe("");
    });
});

describe("examples/receive_payment_failure_notification", () => {
    test("prints verified failure details and nothing otherwise", () => {
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const dir = mkdtempSync(join(tmpdir(), "yoapi-example-"));
        const certPath = join(dir, "cert.pem");
        writeFileSync(certPath, publicKey.export({ type: "spki", format: "pem" }));

        const api = new YoAPI("u", "p", "sandbox");
        api.setPublicKeyFileUrl(certPath);

        const form = {
            failed_transaction_reference: "TRX-FAIL-1",
            transaction_init_date: "2026-09-07 10:00:00",
            verification: "",
        };
        const data = form.failed_transaction_reference + form.transaction_init_date;
        form.verification = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }) as string)).toString("base64");

        const message = handlePaymentFailureNotification(api, form);

        expect(message).toContain("FAILED TRANSACTION REFERENCE: TRX-FAIL-1");
        expect(message).toContain("TRANSACTION INITIATION DATE: 2026-09-07 10:00:00");
        expect(handlePaymentFailureNotification(api, { ...form, verification: "AAAA" })).toBe("");
    });
});
