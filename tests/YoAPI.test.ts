import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as rsaSign, verify as rsaVerify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YoAPI, YoAPIError } from "../index.ts";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

let server: any;
let lastRequest: { url: string; headers: Record<string, string>; body: string } | null = null;
let nextResponse = "";
let nextStatus = 200;

beforeEach(() => {
    lastRequest = null;
    nextResponse = "";
    nextStatus = 200;
});

afterEach(() => {
    if (server) {
        server.stop(true);
        server = undefined;
    }
});

function startServer(): string {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            lastRequest = {
                url: req.url,
                headers: Object.fromEntries(req.headers.entries()),
                body: await req.text(),
            };
            return new Response(nextResponse, { status: nextStatus, headers: { "Content-Type": "text/xml" } });
        },
    });
    return `http://localhost:${server.port}/task.php`;
}

function makeClient(mode: "production" | "sandbox" = "production"): YoAPI {
    const api = new YoAPI("testuser", "testpass", mode);
    api.setUrl(startServer());
    return api;
}

function respond(xml: string, status = 200): void {
    nextResponse = XML_HEADER + xml;
    nextStatus = status;
}

/** Queue a raw (not necessarily XML) response body, e.g. an HTTP error page. */
function respondRaw(text: string, status = 200): void {
    nextResponse = text;
    nextStatus = status;
}

describe("constructor and getters/setters", () => {
    test("production mode defaults to production URL", () => {
        const api = new YoAPI("u", "p");
        expect(api.getUrl()).toBe("https://paymentsapi1.yo.co.ug/ybs/task.php");
        expect(api.getMode()).toBe("production");
        expect(api.getUsername()).toBe("u");
        expect(api.getPassword()).toBe("p");
        expect(api.getNonblocking()).toBe("FALSE");
        expect(api.getExternalReference()).toBe(null);
        expect(api.getInternalReference()).toBe(null);
        expect(api.getProviderReferenceText()).toBe(null);
        expect(api.getInstantNotificationUrl()).toBe(null);
        expect(api.getFailureNotificationUrl()).toBe(null);
        expect(api.getAuthenticationSignatureBase64()).toBe(null);
        expect(api.getTransactionLimitAccountIdentifier()).toBe(null);
        expect(api.getPublicKeyAuthenticationNonce()).toBe(null);
        expect(api.getPublicKeyAuthenticationSignatureBase64()).toBe(null);
        expect(api.getPrivateKeyFileLocation()).toBe(null);
        expect(api.getPrivateKeyContent()).toBe(null);
        expect(api.getDepositTransactionType()).toBe("PULL");
        expect(api.getTimeout()).toBe(120_000);
        expect(api.getTlsVerificationEnabled()).toBe(true);
        expect(api.getMaxResponseBytes()).toBe(1024 * 1024);
        expect(api.getPublicKeyFileUrl()).toContain("Yo_Uganda_Public_Certificate.crt");
    });

    test("sandbox mode defaults to sandbox URL and sandbox certificate", () => {
        const api = new YoAPI("u", "p", "sandbox");
        expect(api.getMode()).toBe("sandbox");
        expect(api.getUrl()).toBe("https://sandbox.yo.co.ug/services/yopaymentsdev/task.php");
        expect(api.getPublicKeyFileUrl()).toContain("Yo_Uganda_Public_Sandbox_Certificate.crt");
    });

    test("setters update values", () => {
        const api = makeClient();
        api.setUsername("u2");
        api.setPassword("p2");
        api.setUrl("https://example.com/task.php");
        api.setPublicKeyFileUrl("/tmp/cert.crt");
        api.setNonblocking("TRUE");
        api.setExternalReference("INV-1");
        api.setInternalReference("INT-1");
        api.setProviderReferenceText("Thanks!");
        api.setInstantNotificationUrl("https://example.com/ipn");
        api.setFailureNotificationUrl("https://example.com/fail");
        api.setAuthenticationSignatureBase64("sig==");
        api.setDepositTransactionType("PUSH");
        api.setTransactionLimitAccountIdentifier("TL-1");
        api.setPublicKeyAuthenticationNonce("nonce-1");
        api.setPublicKeyAuthenticationSignatureBase64("psig==");
        api.setPrivateKeyFileLocation("/tmp/key.pem");
        api.setPrivateKeyContent("PEM-CONTENT");
        api.setTimeout(5000);
        api.setTlsVerificationEnabled(false);
        api.setMaxResponseBytes(2048);

        expect(api.getUsername()).toBe("u2");
        expect(api.getPassword()).toBe("p2");
        expect(api.getUrl()).toBe("https://example.com/task.php");
        expect(api.getPublicKeyFileUrl()).toBe("/tmp/cert.crt");
        expect(api.getNonblocking()).toBe("TRUE");
        expect(api.getExternalReference()).toBe("INV-1");
        expect(api.getInternalReference()).toBe("INT-1");
        expect(api.getProviderReferenceText()).toBe("Thanks!");
        expect(api.getInstantNotificationUrl()).toBe("https://example.com/ipn");
        expect(api.getFailureNotificationUrl()).toBe("https://example.com/fail");
        expect(api.getAuthenticationSignatureBase64()).toBe("sig==");
        expect(api.getDepositTransactionType()).toBe("PUSH");
        expect(api.getTransactionLimitAccountIdentifier()).toBe("TL-1");
        expect(api.getPublicKeyAuthenticationNonce()).toBe("nonce-1");
        expect(api.getPublicKeyAuthenticationSignatureBase64()).toBe("psig==");
        expect(api.getPrivateKeyFileLocation()).toBe("/tmp/key.pem");
        expect(api.getPrivateKeyContent()).toBe("PEM-CONTENT");
        expect(api.getTimeout()).toBe(5000);
        expect(api.getTlsVerificationEnabled()).toBe(false);
        expect(api.getMaxResponseBytes()).toBe(2048);
    });
});

describe("acDepositFunds", () => {
    test("sends correct XML and parses successful response", async () => {
        const api = makeClient();
        api.setNonblocking("TRUE");
        api.setExternalReference("EXT-1");
        api.setInternalReference("INT-1");
        api.setProviderReferenceText("Pay me");
        api.setInstantNotificationUrl("https://example.com/ipn");
        api.setFailureNotificationUrl("https://example.com/fail");
        api.setAuthenticationSignatureBase64("AUTHSIG");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Success</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-123</TransactionReference>" +
                "<MNOTransactionReferenceId>MNO-9</MNOTransactionReferenceId><IssuedReceiptNumber>R-77</IssuedReceiptNumber>" +
                "</Response>",
        );

        const result = await api.acDepositFunds("256770000000", 10000, "Reason");

        expect(result).toEqual({
            Status: "OK",
            StatusCode: "200",
            StatusMessage: "Success",
            TransactionStatus: "SUCCEEDED",
            TransactionReference: "TRX-123",
            MNOTransactionReferenceId: "MNO-9",
            IssuedReceiptNumber: "R-77",
        });

        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acdepositfunds</Method><NonBlocking>TRUE</NonBlocking>" +
                "<Account>256770000000</Account><Amount>10000</Amount><Narrative>Reason</Narrative>" +
                "<ExternalReference>EXT-1</ExternalReference><InternalReference>INT-1</InternalReference>" +
                "<ProviderReferenceText>Pay me</ProviderReferenceText>" +
                "<InstantNotificationUrl>https://example.com/ipn</InstantNotificationUrl>" +
                "<FailureNotificationUrl>https://example.com/fail</FailureNotificationUrl>" +
                "<AuthenticationSignatureBase64>AUTHSIG</AuthenticationSignatureBase64>" +
                "</Request></AutoCreate>",
        );
        expect(lastRequest!.headers["content-type"]).toBe("text/xml");
        expect(lastRequest!.headers["content-transfer-encoding"]).toBe("text");
        expect(lastRequest!.headers["content-length"]).toBe(String(Buffer.byteLength(lastRequest!.body)));
    });

    test("omits optional fields when not set and includes error fields on failure", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>FAILED</Status><StatusCode>500</StatusCode><StatusMessage>Failed</StatusMessage>" +
                "<TransactionStatus>FAILED</TransactionStatus><ErrorMessageCode>INVALID_MSISDN</ErrorMessageCode>" +
                "<ErrorMessage>Bad number</ErrorMessage></Response>",
        );

        const result = await api.acDepositFunds("256770000000", 500.5, "Pay");

        expect(result.ErrorMessageCode).toBe("INVALID_MSISDN");
        expect(result.ErrorMessage).toBe("Bad number");
        expect(result.TransactionReference).toBeUndefined();
        expect(result.IssuedReceiptNumber).toBeUndefined();

        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acdepositfunds</Method><NonBlocking>FALSE</NonBlocking>" +
                "<Account>256770000000</Account><Amount>500.5</Amount><Narrative>Pay</Narrative>" +
                "</Request></AutoCreate>",
        );
    });

    test('excludes fields whose value is "0" (PHP empty() semantics)', async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>0</TransactionReference>" +
                "</Response>",
        );

        const result = await api.acDepositFunds("256770000000", 100, "Pay");

        expect(result.TransactionReference).toBeUndefined();
    });

    test("content-length counts bytes for non-ASCII narratives", async () => {
        const api = makeClient();
        respond("<Response><Status>OK</Status><StatusCode>200</StatusCode></Response>");

        await api.acDepositFunds("256770000000", 100, "Gift 🎉");

        expect(lastRequest!.body).toContain("<Narrative>Gift 🎉</Narrative>");
        expect(lastRequest!.headers["content-length"]).toBe(String(Buffer.byteLength(lastRequest!.body)));
    });
});

describe("acTransactionCheckStatus", () => {
    test("sends transaction reference and parses full response", async () => {
        const api = makeClient();
        api.setDepositTransactionType("PUSH");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-1</TransactionReference>" +
                "<Amount>10000</Amount><AmountFormatted>UGX 10,000</AmountFormatted><CurrencyCode>UGX</CurrencyCode>" +
                "<TransactionInitiationDate>2026-09-07T10:00:00</TransactionInitiationDate>" +
                "<TransactionCompletionDate>2026-09-07T10:01:00</TransactionCompletionDate>" +
                "<IssuedReceiptNumber>R-1</IssuedReceiptNumber></Response>",
        );

        const result = await api.acTransactionCheckStatus("TRX-1", "EXT-1");

        expect(result.Amount).toBe("10000");
        expect(result.AmountFormatted).toBe("UGX 10,000");
        expect(result.CurrencyCode).toBe("UGX");
        expect(result.TransactionInitiationDate).toBe("2026-09-07T10:00:00");
        expect(result.TransactionCompletionDate).toBe("2026-09-07T10:01:00");
        expect(result.IssuedReceiptNumber).toBe("R-1");

        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>actransactioncheckstatus</Method>" +
                "<TransactionReference>TRX-1</TransactionReference>" +
                "<PrivateTransactionReference>EXT-1</PrivateTransactionReference>" +
                "<DepositTransactionType>PUSH</DepositTransactionType>" +
                "</Request></AutoCreate>",
        );
    });

    test("private reference omitted when null", async () => {
        const api = makeClient();
        respond("<Response><Status>OK</Status><StatusCode>200</StatusCode></Response>");

        await api.acTransactionCheckStatus("TRX-1");

        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>actransactioncheckstatus</Method>" +
                "<TransactionReference>TRX-1</TransactionReference>" +
                "<DepositTransactionType>PULL</DepositTransactionType>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("acInternalTransfer", () => {
    test("sends correct XML and parses response", async () => {
        const api = makeClient();
        api.setExternalReference("EXT-9");
        api.setInternalReference("INT-9");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Transferred</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-9</TransactionReference>" +
                "<IssuedReceiptNumber>R-9</IssuedReceiptNumber></Response>",
        );

        const result = await api.acInternalTransfer("UGX-MTNMM", 2000, 1000123, "dest@example.com", "Transfer");

        expect(result.Status).toBe("OK");
        expect(result.TransactionReference).toBe("TRX-9");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acinternaltransfer</Method>" +
                "<CurrencyCode>UGX-MTNMM</CurrencyCode>" +
                "<Amount>2000</Amount>" +
                "<BeneficiaryAccount>1000123</BeneficiaryAccount>" +
                "<BeneficiaryEmail>dest@example.com</BeneficiaryEmail>" +
                "<Narrative>Transfer</Narrative>" +
                "<InternalReference>INT-9</InternalReference>" +
                "<ExternalReference>EXT-9</ExternalReference>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("acAcctBalance", () => {
    test("parses multiple currency balances", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode>" +
                "<Balance><Currency><Code>UGX</Code><Balance>50000</Balance></Currency>" +
                "<Currency><Code>UGX-MTNAT</Code><Balance>1500</Balance></Currency></Balance></Response>",
        );

        const result = await api.acAcctBalance();

        expect(result.Status).toBe("OK");
        expect(result.balance).toEqual([
            { code: "UGX", balance: "50000" },
            { code: "UGX-MTNAT", balance: "1500" },
        ]);
        expect(lastRequest!.body).toContain("<Method>acacctbalance</Method>");
    });

    test("handles single currency and error responses", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>FAILED</Status><StatusCode>500</StatusCode>" +
                "<Balance><Currency><Code>UGX</Code><Balance>1</Balance></Currency></Balance>" +
                "<ErrorMessageCode>NO_PERMISSION</ErrorMessageCode><ErrorMessage>No permission</ErrorMessage></Response>",
        );

        const result = await api.acAcctBalance();

        expect(result.balance).toEqual([{ code: "UGX", balance: "1" }]);
        expect(result.ErrorMessageCode).toBe("NO_PERMISSION");
        expect(result.ErrorMessage).toBe("No permission");
    });
});

describe("acGetMinistatement", () => {
    test("parses transactions with optional fields", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>2</TotalTransactions>" +
                "<ReturnedTransactions>2</ReturnedTransactions><Transactions>" +
                "<Transaction><TransactionSystemId>SYS-1</TransactionSystemId>" +
                "<TransactionReference>TRX-1</TransactionReference><TransactionStatus>SUCCEEDED</TransactionStatus>" +
                "<InitiationDate>2026-09-07 10:00:00</InitiationDate><CompletionDate>2026-09-07 10:01:00</CompletionDate>" +
                "<NarrativeBase64>SGVsbG8=</NarrativeBase64><NarrativeBase64>U2Vjb25k</NarrativeBase64>" +
                "<Currency>UGX</Currency><Amount>100</Amount><Balance>900</Balance>" +
                "<GeneralType>DEPOSIT</GeneralType><DetailedType>MOBILE_MONEY_DEPOSIT</DetailedType>" +
                "<BeneficiaryMsisdn>256770000000</BeneficiaryMsisdn><BeneficiaryBase64>QmVuZQ==</BeneficiaryBase64>" +
                "<SenderMsisdn>256780000000</SenderMsisdn><SenderBase64>U2VuZGVy</SenderBase64>" +
                "<Base64TransactionExternalReference>RVhULTE=</Base64TransactionExternalReference>" +
                "<TransactionEntryDesignation>TRANSACTION</TransactionEntryDesignation></Transaction>" +
                "<Transaction><TransactionSystemId>SYS-2</TransactionSystemId>" +
                "<TransactionReference>TRX-2</TransactionReference><TransactionStatus>FAILED</TransactionStatus>" +
                "<InitiationDate>2026-09-07 11:00:00</InitiationDate><CompletionDate>2026-09-07 11:01:00</CompletionDate>" +
                "<NarrativeBase64>QmFk</NarrativeBase64><Currency>UGX</Currency><Amount>200</Amount>" +
                "<Balance>700</Balance><GeneralType>WITHDRAWAL</GeneralType><DetailedType>MOBILE_MONEY_WITHDRAWAL</DetailedType>" +
                "<BeneficiaryBase64>QmVuZTI=</BeneficiaryBase64><SenderBase64>U2VuZGVyMg==</SenderBase64>" +
                "<TransactionEntryDesignation>CHARGES</TransactionEntryDesignation></Transaction>" +
                "</Transactions></Response>",
        );

        const result = await api.acGetMinistatement(
            "2026-09-01 00:00:00",
            "2026-09-07 23:59:59",
            "FAILED,SUCCEEDED",
            "UGX-MTNMM",
            50,
            "ANY",
            "EXT-1",
        );

        expect(result.TotalTransactions).toBe("2");
        expect(result.ReturnedTransactions).toBe("2");
        expect(result.Transactions).toHaveLength(2);

        expect(result.Transactions[0]!.NarrativeBase64).toBe("SGVsbG8=");
        expect(result.Transactions[0]!.BeneficiaryMsisdn).toBe("256770000000");
        expect(result.Transactions[0]!.SenderMsisdn).toBe("256780000000");
        expect(result.Transactions[0]!.Base64TransactionExternalReference).toBe("RVhULTE=");

        expect(result.Transactions[1]!.BeneficiaryMsisdn).toBeUndefined();
        expect(result.Transactions[1]!.SenderMsisdn).toBeUndefined();
        expect(result.Transactions[1]!.TransactionEntryDesignation).toBe("CHARGES");

        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acgetministatement</Method>" +
                "<StartDate>2026-09-01 00:00:00</StartDate>" +
                "<EndDate>2026-09-07 23:59:59</EndDate>" +
                "<TransactionStatus>FAILED,SUCCEEDED</TransactionStatus>" +
                "<CurrencyCode>UGX-MTNMM</CurrencyCode>" +
                "<ResultSetLimit>50</ResultSetLimit>" +
                "<TransactionEntryDesignation>ANY</TransactionEntryDesignation>" +
                "<ExternalReference>EXT-1</ExternalReference>" +
                "</Request></AutoCreate>",
        );
    });

    test("defaults and omitted optional params", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>0</TotalTransactions>" +
                "<ReturnedTransactions>0</ReturnedTransactions></Response>",
        );

        const result = await api.acGetMinistatement();

        expect(result.Transactions).toEqual([]);
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acgetministatement</Method>" +
                "<TransactionEntryDesignation>ANY</TransactionEntryDesignation>" +
                "</Request></AutoCreate>",
        );
    });

    test("parses a single transaction element", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>1</TotalTransactions>" +
                "<ReturnedTransactions>1</ReturnedTransactions><Transactions>" +
                "<Transaction><TransactionSystemId>SYS-1</TransactionSystemId>" +
                "<TransactionReference>TRX-1</TransactionReference><TransactionStatus>SUCCEEDED</TransactionStatus>" +
                "<InitiationDate>2026-09-07 10:00:00</InitiationDate><CompletionDate>2026-09-07 10:01:00</CompletionDate>" +
                "<NarrativeBase64>SGVsbG8=</NarrativeBase64>" +
                "<Currency>UGX</Currency><Amount>100</Amount><Balance>900</Balance>" +
                "<GeneralType>DEPOSIT</GeneralType><DetailedType>MOBILE_MONEY_DEPOSIT</DetailedType>" +
                "<BeneficiaryBase64>QmVuZQ==</BeneficiaryBase64><SenderBase64>U2VuZGVy</SenderBase64>" +
                "<TransactionEntryDesignation>TRANSACTION</TransactionEntryDesignation></Transaction>" +
                "</Transactions></Response>",
        );

        const result = await api.acGetMinistatement();

        expect(result.Transactions).toHaveLength(1);
        expect(result.Transactions[0]!.TransactionReference).toBe("TRX-1");
        expect(result.Transactions[0]!.NarrativeBase64).toBe("SGVsbG8=");
    });

    test("a ResultSetLimit of 0 is sent (returns all, per gateway docs)", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><TotalTransactions>0</TotalTransactions>" +
                "<ReturnedTransactions>0</ReturnedTransactions></Response>",
        );

        await api.acGetMinistatement(null, null, null, null, 0);

        expect(lastRequest!.body).toContain("<ResultSetLimit>0</ResultSetLimit>");
        expect(lastRequest!.body).not.toContain("StartDate");
    });
});

describe("acSendAirtimeMobile", () => {
    test("sends correct XML and parses response", async () => {
        const api = makeClient();
        api.setNonblocking("TRUE");
        api.setExternalReference("EXT-2");
        api.setProviderReferenceText("Free airtime");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Sent</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-2</TransactionReference>" +
                "<MNOTransactionReferenceId>MNO-2</MNOTransactionReferenceId><IssuedReceiptNumber>R-2</IssuedReceiptNumber>" +
                "</Response>",
        );

        const result = await api.acSendAirtimeMobile("256770000000", 500, "Airtime gift");

        expect(result.Status).toBe("OK");
        expect(result.TransactionReference).toBe("TRX-2");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acsendairtimemobile</Method>" +
                "<NonBlocking>TRUE</NonBlocking>" +
                "<Account>256770000000</Account>" +
                "<Amount>500</Amount>" +
                "<Narrative>Airtime gift</Narrative>" +
                "<ExternalReference>EXT-2</ExternalReference>" +
                "<ProviderReferenceText>Free airtime</ProviderReferenceText>" +
                "</Request></AutoCreate>",
        );
    });

    test('includes fields whose value is "0"', async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Sent</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><IssuedReceiptNumber>0</IssuedReceiptNumber>" +
                "</Response>",
        );

        const result = await api.acSendAirtimeMobile("256770000000", 500, "Airtime gift");

        expect(result.IssuedReceiptNumber).toBe("0");
    });
});

describe("acSendAirtimeInternal", () => {
    test("sends correct XML and parses response", async () => {
        const api = makeClient();
        api.setExternalReference("EXT-3");
        api.setInternalReference("INT-3");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Sent</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-3</TransactionReference>" +
                "</Response>",
        );

        const result = await api.acSendAirtimeInternal("UGX-MTNAT", 300, 1000456, "friend@example.com", "Gift");

        expect(result.Status).toBe("OK");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acsendairtimeinternal</Method>" +
                "<CurrencyCode>UGX-MTNAT</CurrencyCode>" +
                "<Amount>300</Amount>" +
                "<BeneficiaryAccount>1000456</BeneficiaryAccount>" +
                "<BeneficiaryEmail>friend@example.com</BeneficiaryEmail>" +
                "<Narrative>Gift</Narrative>" +
                "<InternalReference>INT-3</InternalReference>" +
                "<ExternalReference>EXT-3</ExternalReference>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("acWithdrawFunds", () => {
    test("includes public key auth fields when set", async () => {
        const api = makeClient();
        api.setExternalReference("EXT-4");
        api.setTransactionLimitAccountIdentifier("TL-4");
        api.setPublicKeyAuthenticationNonce("nonce-4");
        api.setPublicKeyAuthenticationSignatureBase64("PSIG-4");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>OK</StatusMessage>" +
                "<TransactionStatus>SUCCEEDED</TransactionStatus><TransactionReference>TRX-4</TransactionReference>" +
                "<IssuedReceiptNumber>R-4</IssuedReceiptNumber></Response>",
        );

        const result = await api.acWithdrawFunds("256770000000", 1000, "Withdraw");

        expect(result.Status).toBe("OK");
        expect(result.IssuedReceiptNumber).toBe("R-4");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acwithdrawfunds</Method>" +
                "<NonBlocking>FALSE</NonBlocking>" +
                "<Account>256770000000</Account>" +
                "<Amount>1000</Amount>" +
                "<Narrative>Withdraw</Narrative>" +
                "<ExternalReference>EXT-4</ExternalReference>" +
                "<TransactionLimitAccountIdentifier>TL-4</TransactionLimitAccountIdentifier>" +
                "<PublicKeyAuthenticationNonce>nonce-4</PublicKeyAuthenticationNonce>" +
                "<PublicKeyAuthenticationSignatureBase64>PSIG-4</PublicKeyAuthenticationSignatureBase64>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("acUserPurchaseAirtimestock", () => {
    test("sends correct XML and parses response", async () => {
        const api = makeClient();
        api.setExternalReference("EXT-5");
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Purchased</StatusMessage>" +
                "<TransactionReference>TRX-5</TransactionReference><TotalCurrencyDebited>1000</TotalCurrencyDebited>" +
                "<CommissionAmount>50</CommissionAmount></Response>",
        );

        const result = await api.acUserPurchaseAirtimestock("UGX-MTNAT", 1000);

        expect(result.TotalCurrencyDebited).toBe("1000");
        expect(result.CommissionAmount).toBe("50");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acuserpurchaseairtimestock</Method>" +
                "<AirtimeCurrencyCode>UGX-MTNAT</AirtimeCurrencyCode>" +
                "<Amount>1000</Amount>" +
                "<TransactionReference>EXT-5</TransactionReference>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("acGetMsisdnKycInfo", () => {
    test("parses names", async () => {
        const api = makeClient();
        respond(
            "<Response><Status>OK</Status><StatusCode>200</StatusCode><StatusMessage>Found</StatusMessage>" +
                "<AccountInformation><PersonalInformation><Names><FirstName>John</FirstName>" +
                "<MiddleName>Middle</MiddleName><Surname>Doe</Surname></Names></PersonalInformation>" +
                "</AccountInformation></Response>",
        );

        const result = await api.acGetMsisdnKycInfo("256770000000");

        expect(result.FirstName).toBe("John");
        expect(result.MiddleName).toBe("Middle");
        expect(result.Surname).toBe("Doe");
        expect(lastRequest!.body).toBe(
            XML_HEADER +
                "<AutoCreate><Request>" +
                "<APIUsername>testuser</APIUsername><APIPassword>testpass</APIPassword>" +
                "<Method>acgetmsisdnkycinfo</Method>" +
                "<Msisdn>256770000000</Msisdn>" +
                "</Request></AutoCreate>",
        );
    });
});

describe("generatePublicKeyAuthenticationSignature", () => {
    function tempRsaKeyPair(): { keyPath: string; pubKeyPem: string } {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const keyPath = join(dir, "private.pem");
        writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
        return { keyPath, pubKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string };
    }

    test("throws when nonce is not set", () => {
        const api = makeClient();
        api.setPrivateKeyFileLocation("/tmp/whatever.pem");
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Public key authentication nonce is not set. Please set it to continue",
        );
    });

    test("throws when private key location is not set", () => {
        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Private key file location cannot be NULL",
        );
    });

    test("throws when private key file cannot be opened", () => {
        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        api.setPrivateKeyFileLocation(join(tmpdir(), "definitely-missing-key.pem"));
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Private key file could not be opened. Confirm your file location",
        );
    });

    test("throws when private key is invalid", () => {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const keyPath = join(dir, "bad.pem");
        writeFileSync(keyPath, "not a key");

        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        api.setPrivateKeyFileLocation(keyPath);
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Private key is invalid",
        );
    });

    test("throws when nonce is an empty string", () => {
        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("");
        api.setPrivateKeyFileLocation("/tmp/whatever.pem");
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Public key authentication nonce is not set. Please set it to continue",
        );
    });

    test("throws when private key location is an empty string", () => {
        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        api.setPrivateKeyFileLocation("");
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Private key file location cannot be NULL",
        );
    });

    test("signs with inline key content when no file location is set", () => {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const keyPath = join(dir, "private.pem");
        writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
        const pubKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
        const privatePem = readFileSync(keyPath, "utf-8");

        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce-content");
        api.setExternalReference("EXT-C");
        api.setPrivateKeyContent(privatePem);

        api.generatePublicKeyAuthenticationSignature("256770000000", 100, "Narrative");

        const signatureBase64 = api.getPublicKeyAuthenticationSignatureBase64();
        expect(signatureBase64).not.toBe(null);

        const data = "testuser" + "100" + "256770000000" + "Narrative" + "EXT-C" + "nonce-content";
        const sha1Hex = createHash("sha1").update(data).digest("hex");
        expect(
            rsaVerify(
                "sha1",
                Buffer.from(sha1Hex, "utf-8"),
                createPublicKey(pubKeyPem),
                Buffer.from(signatureBase64!, "base64"),
            ),
        ).toBe(true);
    });

    test("inline key content takes precedence over the file location", () => {
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        api.setPrivateKeyFileLocation(join(tmpdir(), "definitely-missing-key.pem"));
        api.setPrivateKeyContent(privatePem);

        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).not.toThrow();
    });

    test("throws when inline key content is invalid", () => {
        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce");
        api.setPrivateKeyContent("not a key");
        expect(() => api.generatePublicKeyAuthenticationSignature("256770000000", 100, "n")).toThrow(
            "Private key is invalid",
        );
    });

    test("generates a verifiable base64 signature over sha1 of concatenated data", () => {
        const { keyPath, pubKeyPem } = tempRsaKeyPair();

        const api = makeClient();
        api.setPublicKeyAuthenticationNonce("nonce-123");
        api.setExternalReference("EXT-77");
        api.setPrivateKeyFileLocation(keyPath);

        api.generatePublicKeyAuthenticationSignature("256770000000", 100, "Narrative");

        const signatureBase64 = api.getPublicKeyAuthenticationSignatureBase64();
        expect(signatureBase64).not.toBe(null);

        const data = "testuser" + "100" + "256770000000" + "Narrative" + "EXT-77" + "nonce-123";
        const sha1Hex = createHash("sha1").update(data).digest("hex");

        const ok = rsaVerify(
            "sha1",
            Buffer.from(sha1Hex, "utf-8"),
            createPublicKey(pubKeyPem),
            Buffer.from(signatureBase64!, "base64"),
        );
        expect(ok).toBe(true);
    });
});

describe("payment notifications", () => {
    function tempRsaKeyPair(): { privatePem: string; publicPem: string } {
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        return {
            privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
            publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
        };
    }

    test("verifies a valid payment notification signed with the configured certificate", () => {
        const { privatePem, publicPem } = tempRsaKeyPair();
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const certPath = join(dir, "cert.pem");
        writeFileSync(certPath, publicPem);

        const body = {
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "",
        };
        const data = body.date_time + body.amount + body.narrative + body.network_ref + body.external_ref + body.msisdn;
        body.signature = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privatePem)).toString("base64");

        const api = makeClient();
        api.setPublicKeyFileUrl(certPath);

        const result = api.receivePaymentNotification(body);

        expect(result.is_verified).toBe(true);
        expect(result).toEqual({
            is_verified: true,
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
        });
    });

    test("rejects a tampered payment notification", () => {
        const { privatePem, publicPem } = tempRsaKeyPair();
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const certPath = join(dir, "cert.pem");
        writeFileSync(certPath, publicPem);

        const body = {
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "",
        };
        const data = body.date_time + body.amount + body.narrative + body.network_ref + body.external_ref + body.msisdn;
        body.signature = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privatePem)).toString("base64");

        const api = makeClient();
        api.setPublicKeyFileUrl(certPath);

        const tampered = api.receivePaymentNotification({ ...body, amount: "9999" });
        expect(tampered.is_verified).toBe(false);

        const missing = api.receivePaymentNotification({ ...body, signature: undefined as any });
        expect(missing.is_verified).toBe(false);
    });

    test("returns false when certificate file does not exist", () => {
        const api = makeClient();
        api.setPublicKeyFileUrl(join(tmpdir(), "missing-cert.pem"));

        const result = api.receivePaymentNotification({
            date_time: "2026-09-07 10:00:00",
            amount: "1000",
            narrative: "Payment",
            network_ref: "NET-1",
            external_ref: "EXT-1",
            msisdn: "256770000000",
            signature: "AAAA",
        });

        expect(result.is_verified).toBe(false);
    });

    test("verifies a valid payment failure notification", () => {
        const { privatePem, publicPem } = tempRsaKeyPair();
        const dir = mkdtempSync(join(tmpdir(), "yoapi-test-"));
        const certPath = join(dir, "cert.pem");
        writeFileSync(certPath, publicPem);

        const body = {
            failed_transaction_reference: "TRX-FAIL-1",
            transaction_init_date: "2026-09-07 10:00:00",
            verification: "",
        };
        const data = body.failed_transaction_reference + body.transaction_init_date;
        body.verification = rsaSign("sha256", Buffer.from(data, "utf-8"), createPrivateKey(privatePem)).toString("base64");

        const api = makeClient();
        api.setPublicKeyFileUrl(certPath);

        const result = api.receivePaymentFailureNotification(body);

        expect(result.is_verified).toBe(true);
        expect(result.failed_transaction_reference).toBe("TRX-FAIL-1");
        expect(result.transaction_init_date).toBe("2026-09-07 10:00:00");

        const tampered = api.receivePaymentFailureNotification({
            ...body,
            failed_transaction_reference: "TRX-FAIL-2",
        });
        expect(tampered.is_verified).toBe(false);
    });

    test("bundled Yo certificates exist and are loadable", () => {
        const sandboxApi = new YoAPI("u", "p", "sandbox");
        expect(sandboxApi.getPublicKeyFileUrl()).toContain("Yo_Uganda_Public_Sandbox_Certificate.crt");
        const prodApi = new YoAPI("u", "p");
        expect(prodApi.getPublicKeyFileUrl()).toContain("Yo_Uganda_Public_Certificate.crt");

        for (const api of [sandboxApi, prodApi]) {
            const cert = readFileSync(api.getPublicKeyFileUrl(), "utf-8");
            expect(() => createPublicKey(cert)).not.toThrow();
        }
    });
});

describe("gateway error handling", () => {
    test("non-2xx responses throw YoAPIError with status and body", async () => {
        const api = makeClient();
        respondRaw("<html><body>Bad Gateway</body></html>", 502);

        let error: unknown = null;
        try {
            await api.acAcctBalance();
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(YoAPIError);
        expect((error as YoAPIError).status).toBe(502);
        expect((error as YoAPIError).body).toContain("Bad Gateway");
    });

    test("malformed XML responses throw YoAPIError", async () => {
        const api = makeClient();
        respondRaw("<Response><Status>OK", 200);

        let error: unknown = null;
        try {
            await api.acAcctBalance();
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(YoAPIError);
        expect((error as Error).message).toContain("Invalid XML");
    });

    test("well-formed XML without a Response node throws YoAPIError", async () => {
        const api = makeClient();
        respondRaw('<?xml version="1.0" encoding="UTF-8"?><AutoCreate><Nothing/></AutoCreate>', 200);

        let error: unknown = null;
        try {
            await api.acAcctBalance();
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(YoAPIError);
        expect((error as Error).message).toContain("<Response>");
    });

    test("oversized responses throw YoAPIError", async () => {
        const api = makeClient();
        api.setMaxResponseBytes(10);
        respond("<Response><Status>OK</Status><StatusCode>200</StatusCode></Response>");

        let error: unknown = null;
        try {
            await api.acAcctBalance();
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(YoAPIError);
        expect((error as Error).message).toContain("exceeds the limit");
    });

    test("a timeout of 0 disables the timeout", async () => {
        const api = makeClient();
        api.setTimeout(0);
        respond("<Response><Status>OK</Status><StatusCode>200</StatusCode></Response>");

        const result = await api.acAcctBalance();

        expect(result.Status).toBe("OK");
    });
});

describe("network behaviour", () => {
    test("network errors propagate as rejected promises", async () => {
        const api = new YoAPI("u", "p");
        api.setUrl("http://127.0.0.1:9/task.php");

        let error: unknown = null;
        try {
            await api.acAcctBalance();
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(YoAPIError);
        expect((error as YoAPIError).cause).toBeDefined();
    });

    test("timeout aborts the request", async () => {
        const hanging = Bun.serve({
            port: 0,
            fetch: () => new Promise<Response>(() => {}),
        });
        try {
            const api = new YoAPI("u", "p");
            api.setUrl(`http://localhost:${hanging.port}/task.php`);
            api.setTimeout(50);

            let error: unknown = "no error thrown";
            try {
                await api.acAcctBalance();
            } catch (e) {
                error = e;
            }
            // Bun aborts with a DOMException (TimeoutError); any thrown value is fine.
            expect(error).not.toBe("no error thrown");
        } finally {
            hanging.stop(true);
        }
    });
});
