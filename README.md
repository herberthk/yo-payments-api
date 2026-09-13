# @herberthtk/yo-payments-api

[![npm version](https://img.shields.io/npm/v/@herberthtk/yo-payments-api.svg)](https://www.npmjs.com/package/@herberthtk/yo-payments-api)
[![CI](https://github.com/herberthk/yo-payments-api/actions/workflows/ci.yml/badge.svg)](https://github.com/herberthk/yo-payments-api/actions)
[![license](https://img.shields.io/npm/l/@herberthtk/yo-payments-api.svg)](https://github.com/herberthk/yo-payments-api/blob/main/LICENSE)

TypeScript client for the [Yo! Payments API PHP library](https://github.com/YO-Uganda) (`YoAPI.php`) for mobile money, airtime and account operations on the Yo! Payments gateway. Runs on [Bun](https://bun.com) and Node.js 18+ (uses `fetch` + `node:crypto`), including Next.js App Router handlers, Server Actions and Server Components (**server-side only** — never import it into a Client Component).

## Install

```bash
npm install @herberthtk/yo-payments-api
# or: bun add @herberthtk/yo-payments-api
```

## Quick start

```ts
import { YoAPI } from "@herberthtk/yo-payments-api";

// production by default; pass "sandbox" as the third argument for sandbox mode
const yoAPI = new YoAPI("API_USERNAME", "API_PASSWORD");

// Request a mobile money user to deposit funds into your account
const response = await yoAPI.acDepositFunds(
  "256770000000",
  10000,
  "Reason for transfer of funds",
);
if (response.Status === "OK") {
  console.log("Transaction Reference =", response.TransactionReference);
}

// Check the balance of your account
const balance = await yoAPI.acAcctBalance();
console.log(balance.balance); // [{ code: "UGX", balance: "50000" }, ...]
```

All network methods are `async` and return typed response objects. Method names use idiomatic camelCase (e.g. `acDepositFunds`, `setExternalReference`, `getTransactionLimitAccountIdentifier`) — the one intentional divergence from the PHP library's `snake_case` names; the XML wire format is unchanged.

## Configuration

```ts
const yoAPI = new YoAPI(username: string, password: string, mode: "production" | "sandbox" = "production");
```

| Setter                                      | Type                | Default      | Purpose                                                                        |
| ------------------------------------------- | ------------------- | ------------ | ------------------------------------------------------------------------------ |
| `setExternalReference`                      | `string \| null`    | `null`       | Your reference for the payment (e.g. invoice number); sent with most requests  |
| `setInternalReference`                      | `string \| null`    | `null`       | Reference to another Yo! Payments system transaction                           |
| `setNonblocking`                            | `"TRUE" \| "FALSE"` | `"FALSE"`    | `"TRUE"` returns immediately; poll status or use IPN URLs                      |
| `setInstantNotificationUrl`                 | `string \| null`    | `null`       | URL POSTed on successful deposit (non-blocking flow)                           |
| `setFailureNotificationUrl`                 | `string \| null`    | `null`       | URL POSTed on failed deposit (non-blocking flow)                               |
| `setProviderReferenceText`                  | `string \| null`    | `null`       | Text appended to the subscriber's confirmation SMS                             |
| `setAuthenticationSignatureBase64`          | `string \| null`    | `null`       | Required for certain deposit requests (ask Yo! support)                        |
| `setDepositTransactionType`                 | `"PULL" \| "PUSH"`  | `"PULL"`     | Which deposit flow `acTransactionCheckStatus` follows up on                    |
| `setTransactionLimitAccountIdentifier`      | `string \| null`    | `null`       | Ask your account administrator before using                                    |
| `setPublicKeyAuthenticationNonce`           | `string \| null`    | `null`       | Unique-per-request nonce for public-key-auth payouts                           |
| `setPublicKeyAuthenticationSignatureBase64` | `string \| null`    | `null`       | Usually set via `generatePublicKeyAuthenticationSignature`                     |
| `setPrivateKeyFileLocation`                 | `string \| null`    | `null`       | Path to the signing private key (PEM file)                                     |
| `setPrivateKeyContent`                      | `string \| null`    | `null`       | Key PEM text; for serverless hosts without key files (wins over file location) |
| `setPublicKeyFileUrl`                       | `string`            | bundled cert | Certificate used to verify IPN signatures                                      |
| `setUrl`                                    | `string`            | gateway URL  | Override the API endpoint (testing/proxies)                                    |
| `setTimeout`                                | `number` (ms)       | `120000`     | Request timeout; `<= 0` disables it                                            |
| `setTlsVerificationEnabled`                 | `boolean`           | `true`       | Only disable for testing against self-signed endpoints                         |
| `setMaxResponseBytes`                       | `number`            | `1048576`    | Cap on gateway response bodies                                                 |

Every setter has a matching getter (`getExternalReference()`, `getMode()`, …). One instance holds per-request state, so create a fresh client per request — never share one across concurrent operations.

## API reference

Conventions used below:

- **Success** — `Status: "OK"` (and usually `TransactionStatus: "SUCCEEDED"`); reference fields are present.
- **Business failure** — returned as a normal object, never thrown: `Status: "FAILED"` with `ErrorMessageCode` / `ErrorMessage` set. Check `Status` (and `TransactionStatus`) before trusting reference fields.
- **Transport failure** — thrown as `YoAPIError`: connection errors, timeouts, non-2xx HTTP, oversized bodies, malformed XML, missing `<Response>`. See [Error handling](#error-handling).

Amounts accept `number | string` — pass a string when exact formatting matters (e.g. `"100.50"`), since numbers use JavaScript float-to-string conversion. Phone numbers use international format without `+` (e.g. `"256770000000"`).

### acDepositFunds — request a mobile money deposit (USSD PIN prompt)

```ts
const res: DepositFundsResponse = await yoAPI.acDepositFunds(
  msisdn,
  amount,
  narrative,
);
```

| Parameter   | Type               | Description                             |
| ----------- | ------------------ | --------------------------------------- |
| `msisdn`    | `string`           | Subscriber phone, e.g. `"256770000000"` |
| `amount`    | `number \| string` | Amount to collect                       |
| `narrative` | `string`           | Reason shown to the subscriber          |

Response (`DepositFundsResponse`): `Status`, `StatusCode`, `StatusMessage`, `TransactionStatus` always present. On success also `TransactionReference` (save this — it identifies the payment everywhere else), `MNOTransactionReferenceId`, `IssuedReceiptNumber`. On business failure, `ErrorMessageCode` / `ErrorMessage` instead. Optional request tweaks: `setNonblocking("TRUE")` + IPN URLs, `setAuthenticationSignatureBase64`.

### acTransactionCheckStatus — poll a transaction

```ts
const res: TransactionCheckStatusResponse = await yoAPI.acTransactionCheckStatus(
    transactionReference: string | null,
    privateTransactionReference: string | null = null,
);
```

Pass the gateway `TransactionReference`, or `null` plus the `ExternalReference` you sent (`privateTransactionReference`). `setDepositTransactionType("PUSH")` first when following up a push deposit. Same base fields as deposits, plus (when available): `Amount`, `AmountFormatted`, `CurrencyCode`, `TransactionInitiationDate`, `TransactionCompletionDate`. `TransactionStatus` is one of `SUCCEEDED`, `PENDING`, `FAILED`, `INDETERMINATE` — poll until it leaves `PENDING`.

### acInternalTransfer — pay another Yo! Payments account

```ts
const res: DepositFundsResponse = await yoAPI.acInternalTransfer(
    currencyCode: string,      // e.g. "UGX-MTNMM", "UGX-MTNAT", "UGX-WTLAT", "UGX-OULAT", "UGX-AIRAT"
    amount: number | string,
    beneficiaryAccount: number | string,  // recipient Yo! account number
    beneficiaryEmail: string,
    narrative: string,
);
```

Same response shape as deposits (success/failure fields as above).

### acAcctBalance — account balances

```ts
const res: AcctBalanceResponse = await yoAPI.acAcctBalance();
// res.balance → [{ code: "UGX", balance: "50000" }, { code: "UGX-MTNAT", balance: "1500" }, ...]
```

`Status` / `StatusCode` always present, `balance` always an array (possibly empty), plus optional `StatusMessage` / error fields.

### acGetMinistatement — transaction history

```ts
const res: MinistatementResponse = await yoAPI.acGetMinistatement(
    startDate: string | null = null,       // "YYYY-MM-DD HH:MM:SS"
    endDate: string | null = null,         // "YYYY-MM-DD HH:MM:SS"
    transactionStatus: string | null = null, // "SUCCEEDED", "FAILED", "PENDING", "INDETERMINATE", or comma-joined
    currencyCode: string | null = null,    // e.g. "UGX-MTNMM", "UGX-WARIDMM"
    resultSetLimit: number | null = null,  // 0 returns all; gateway default is 15
    transactionEntryDesignation = "ANY",    // "TRANSACTION" | "CHARGES" | "ANY"
    externalReference: string | null = null,
);
```

`Status`, `StatusCode`, `TotalTransactions`, `ReturnedTransactions` and `Transactions` always present. Each `TransactionDetail` carries `TransactionSystemId`, `TransactionReference`, `TransactionStatus`, `InitiationDate`, `CompletionDate`, `NarrativeBase64`, `Currency`, `Amount`, `Balance`, `GeneralType`, `DetailedType`, `BeneficiaryBase64`, `SenderBase64`, `TransactionEntryDesignation`, plus optional `BeneficiaryMsisdn`, `SenderMsisdn`, `Base64TransactionExternalReference` (present only when the gateway sends them).

### acSendAirtimeMobile / acSendAirtimeInternal — send airtime

```ts
// to a phone number
await yoAPI.acSendAirtimeMobile(msisdn, amount, narrative);
// to another Yo! account ("UGX-MTNAT" | "UGX-WTLAT" | "UGX-OULAT" | "UGX-AIRAT")
await yoAPI.acSendAirtimeInternal(
  currencyCode,
  amount,
  beneficiaryAccount,
  beneficiaryEmail,
  narrative,
);
```

Same response shape as deposits.

### acWithdrawFunds — pay out to mobile money (handle with care)

```ts
const res: DepositFundsResponse = await yoAPI.acWithdrawFunds(
  msisdn,
  amount,
  narrative,
);
```

Same response shape as deposits. Requires an API Access Letter; some payouts additionally require public-key authentication — see below. Optional: `setTransactionLimitAccountIdentifier`, `setPublicKeyAuthenticationNonce` + `setPublicKeyAuthenticationSignatureBase64`.

### acUserPurchaseAirtimestock — buy airtime stock with mobile money credit

```ts
const res: PurchaseAirtimeStockResponse = await yoAPI.acUserPurchaseAirtimestock(
    airtimeCurrencyCode: string, // "UGX-MTNAT" | "UGX-AIRAT" | "UGX-OULAT" | "UGX-UTLAT" | "UGX-SMTAT"
    amount: number | string,
);
```

`Status` / `StatusCode` always present; on success `TransactionReference`, `TotalCurrencyDebited`, `CommissionAmount`, `StatusMessage`. (Parity note: your external reference is sent inside a `<TransactionReference>` tag, exactly like the PHP library.)

### acGetMsisdnKycInfo — name lookup before paying out

```ts
const res: MsisdnKycInfoResponse =
  await yoAPI.acGetMsisdnKycInfo("256770000000");
// res.FirstName / res.MiddleName / res.Surname when the gateway returns them
```

MTN Uganda and Airtel Uganda only; needs permission from support@yo.co.ug. `Status` / `StatusCode` always present.

### receivePaymentNotification / receivePaymentFailureNotification — verify IPNs

```ts
const payment: PaymentNotificationResult = yoAPI.receivePaymentNotification({
  date_time,
  amount,
  narrative,
  network_ref,
  external_ref,
  msisdn,
  signature,
});
// payment.is_verified === true → trust payment.msisdn / .amount / .external_ref / ...
const failure: PaymentFailureNotificationResult =
  yoAPI.receivePaymentFailureNotification({
    failed_transaction_reference,
    transaction_init_date,
    verification,
  });
```

Pass the parsed POST form body (PHP reads `$_POST`; here you supply it). Verification is RSA-SHA256 against the bundled Yo! certificate and is fail-closed: any problem (bad signature, missing cert) yields `is_verified: false`, never a throw. Always gate crediting on `is_verified` **and** dedupe on `external_ref` — notifications carry no replay protection.

### generatePublicKeyAuthenticationSignature — sign a payout

```ts
yoAPI.setExternalReference("INV-123");
yoAPI.setPublicKeyAuthenticationNonce(crypto.randomUUID()); // unique per request
yoAPI.setPrivateKeyContent(process.env.YO_PRIVATE_KEY!.replace(/\\n/g, "\n")); // or setPrivateKeyFileLocation(path)
yoAPI.generatePublicKeyAuthenticationSignature(msisdn, amount, narrative); // throws on missing/invalid key
const res = await yoAPI.acWithdrawFunds(msisdn, amount, narrative);
```

Signs `username + amount + msisdn + narrative + externalReference + nonce` (SHA1+RSA per the gateway protocol) and stores it for the next payout call. Throws `"Public key authentication nonce is not set…"`, `"Private key file location cannot be NULL"`, `"Private key file could not be opened…"`, or `"Private key is invalid"`.

### Response examples

Concrete objects each call resolves to. Absent optional fields are omitted (never `null`).

**Deposits, transfers, airtime, withdrawals** (`DepositFundsResponse` family) — success:

```ts
{
  Status: "OK",
  StatusCode: "200",
  StatusMessage: "OK",
  TransactionStatus: "SUCCEEDED",
  TransactionReference: "TRX-EX-1",
  MNOTransactionReferenceId: "MNO-9",
  IssuedReceiptNumber: "R-77",
}
```

Same calls — business failure (returned, not thrown):

```ts
{
  Status: "FAILED",
  StatusCode: "500",
  StatusMessage: "Failed",
  TransactionStatus: "FAILED",
  ErrorMessageCode: "INVALID_MSISDN",
  ErrorMessage: "The MSISDN is invalid",
}
```

**Transaction status** (`TransactionCheckStatusResponse`) — success carries the money fields:

```ts
{
  Status: "OK",
  StatusCode: "200",
  StatusMessage: "OK",
  TransactionStatus: "SUCCEEDED",
  TransactionReference: "TRX-EX-1",
  Amount: "10000",
  AmountFormatted: "UGX 10,000",
  CurrencyCode: "UGX",
  TransactionInitiationDate: "2026-09-07T10:00:00",
  TransactionCompletionDate: "2026-09-07T10:01:00",
  IssuedReceiptNumber: "R-77",
}
```

Still pending — keep polling:

```ts
{
  Status: "OK",
  StatusCode: "200",
  StatusMessage: "OK",
  TransactionStatus: "PENDING",
}
```

**Balance** (`AcctBalanceResponse`):

```ts
{
  Status: "OK",
  StatusCode: "200",
  balance: [
    { code: "UGX", balance: "50000" },
    { code: "UGX-MTNAT", balance: "1500" },
  ],
}
```

**Ministatement** (`MinistatementResponse`) — `Transactions` is always an array:

```ts
{
  Status: "OK",
  StatusCode: "200",
  TotalTransactions: "2",
  ReturnedTransactions: "2",
  Transactions: [
    {
      TransactionSystemId: "SYS-1",
      TransactionReference: "TRX-EX-1",
      TransactionStatus: "SUCCEEDED",
      InitiationDate: "2026-09-07 10:00:00",
      CompletionDate: "2026-09-07 10:01:00",
      NarrativeBase64: "SGVsbG8=",
      Currency: "UGX",
      Amount: "100",
      Balance: "900",
      GeneralType: "DEPOSIT",
      DetailedType: "MOBILE_MONEY_DEPOSIT",
      BeneficiaryMsisdn: "256770000000",
      BeneficiaryBase64: "QmVuZQ==",
      SenderMsisdn: "256780000000",
      SenderBase64: "U2VuZGVy",
      Base64TransactionExternalReference: "RVhULTE=",
      TransactionEntryDesignation: "TRANSACTION",
    },
  ],
}
```

**Airtimestock purchase** (`PurchaseAirtimeStockResponse`):

```ts
{
  Status: "OK",
  StatusCode: "200",
  StatusMessage: "Purchased",
  TransactionReference: "TRX-EX-1",
  TotalCurrencyDebited: "1000",
  CommissionAmount: "50",
}
```

**KYC lookup** (`MsisdnKycInfoResponse`):

```ts
{
  Status: "OK",
  StatusCode: "200",
  StatusMessage: "Found",
  FirstName: "John",
  MiddleName: "Middle",
  Surname: "Doe",
}
```

**Verified payment notification** (`PaymentNotificationResult`):

```ts
{
  is_verified: true,
  date_time: "2026-09-07 10:00:00",
  amount: "1000",
  narrative: "Payment",
  network_ref: "NET-1",
  external_ref: "EXT-1",
  msisdn: "256770000000",
}
```

Unverifiable notification (bad signature or cert problem) — credit nothing:

```ts
{
  is_verified: false,
  date_time: "2026-09-07 10:00:00",
  amount: "9999",
  narrative: "Payment",
  network_ref: "NET-1",
  external_ref: "EXT-1",
  msisdn: "256770000000",
}
```

**Transport failure** — thrown as `YoAPIError`, e.g. gateway HTTP 502:

```ts
// caught error instance:
YoAPIError: Yo! Payments gateway responded with HTTP 502
// e.status === 502
// e.body === "<html><body>Bad Gateway</body></html>"
// e.cause === undefined (set only for connection/timeout errors)
```

## Usage cases

**1. Blocking deposit** — simplest collection flow; the call returns after the subscriber approves:

```ts
const api = new YoAPI(u, p, "sandbox");
api.setExternalReference(`INV-${Date.now()}`);
const res = await api.acDepositFunds("256770000000", 10000, "Order payment");
if (res.Status === "OK" && res.TransactionStatus === "SUCCEEDED") {
  await markPaid(res.TransactionReference!);
} else {
  console.error(res.ErrorMessageCode, res.ErrorMessage);
}
```

**2. Non-blocking deposit with IPN + polling fallback** — instant response, then confirm:

```ts
api.setNonblocking("TRUE");
api.setInstantNotificationUrl("https://example.com/api/yo/ipn");
api.setFailureNotificationUrl("https://example.com/api/yo/failure");
const res = await api.acDepositFunds("256770000000", 10000, "Order payment");
// ...meanwhile your IPN endpoint verifies and credits on payment.external_ref...
// ...and/or poll until settled:
for (;;) {
  const st = await api.acTransactionCheckStatus(null, externalRef);
  if (st.TransactionStatus !== "PENDING") break;
  await new Promise((r) => setTimeout(r, 5000));
}
```

**3. Daily reconciliation from the ministatement:**

```ts
const st = await api.acGetMinistatement(
  "2026-09-10 00:00:00",
  "2026-09-10 23:59:59",
  "SUCCEEDED",
  "UGX-MTNMM",
  0,
);
for (const tx of st.Transactions) await reconcile(tx);
```

**4. Serverless payout with key material (no key files on Vercel/Lambda):**

```ts
api.setExternalReference("SAL-SEP-001");
api.setPublicKeyAuthenticationNonce(crypto.randomUUID());
api.setPrivateKeyContent(process.env.YO_PRIVATE_KEY!.replace(/\\n/g, "\n"));
api.generatePublicKeyAuthenticationSignature("256770000000", 5000, "Payout");
const res = await api.acWithdrawFunds("256770000000", 5000, "Payout");
```

### Receiving payment notifications (IPN)

PHP reads `$_POST` / `php://input` globals, which is impossible in TypeScript, so you pass the parsed form body yourself. Use `setPublicKeyFileUrl` if you need a different certificate (sandbox vs production is picked automatically by the constructor `mode`).

```ts
// Bun HTTP server example
Bun.serve({
  port: 3000,
  async fetch(req) {
    const form = await req.formData();
    const body = Object.fromEntries(form.entries()) as any;

    const yoAPI = new YoAPI("API_USERNAME", "API_PASSWORD", "sandbox");
    const payment = yoAPI.receivePaymentNotification(body);
    if (payment.is_verified) {
      console.log(
        `Payment from ${payment.msisdn} of ${payment.amount} (ref ${payment.external_ref})`,
      );
      // update your transaction status where external_ref = payment.external_ref
    }

    // Failure notifications:
    // const failure = yoAPI.receivePaymentFailureNotification(body);
    return new Response("OK");
  },
});
```

### Usage in Next.js (App Router)

The library is **server-only**: it uses `node:crypto`/`node:fs` and handles API secrets. Add `import "server-only"` (`npm i server-only`) at the top of every file that touches it, keep credentials in server-side env vars (never `NEXT_PUBLIC_*`), and pin `export const runtime = "nodejs"` on route handlers. Ready-to-copy handlers live in `examples/nextjs/`:

```bash
npm install @herberthtk/yo-payments-api server-only
```

```ts
// lib/yo.ts
import "server-only";
import { YoAPI } from "@herberthtk/yo-payments-api";

export function getYoClient() {
  return new YoAPI(
    process.env.YO_API_USERNAME!,
    process.env.YO_API_PASSWORD!,
    "sandbox",
  );
}
```

```ts
// app/api/yo/ipn/route.ts — register this URL as your InstantNotificationUrl
import "server-only";
import { getYoClient } from "@/lib/yo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const body = Object.fromEntries(form.entries()) as any;
  const payment = getYoClient().receivePaymentNotification(body);
  if (!payment.is_verified)
    return new Response("NOT VERIFIED", { status: 400 });

  // TODO: persist + mark processed idempotently on payment.external_ref
  return new Response("OK");
}
```

```ts
// app/actions.ts — deposits from a Client Component form action
"use server";
import { getYoClient } from "@/lib/yo";

export async function requestDeposit(
  msisdn: string,
  amount: number,
  narrative: string,
) {
  const api = getYoClient();
  api.setExternalReference(`${Date.now()}`);
  const res = await api.acDepositFunds(msisdn, amount, narrative);
  if (res.Status === "OK")
    return { ok: true, reference: res.TransactionReference };
  return { ok: false, message: res.StatusMessage };
}
```

```tsx
// app/statement/page.tsx — Server Component (all reads return JSON-safe data)
import { getYoClient } from "@/lib/yo";

export default async function StatementPage() {
  const res = await getYoClient().acGetMinistatement(
    null,
    null,
    "SUCCEEDED",
    "UGX-MTNMM",
    0,
  );
  return <pre>{JSON.stringify(res.Transactions, null, 2)}</pre>;
}
```

Feature map: deposits/status checks → Server Actions (`examples/nextjs/lib/actions.ts`); balances/ministatements/KYC → Server Components or actions (`examples/nextjs/lib/queries.ts`); IPN + failure notices → Route Handlers (`examples/nextjs/app/api/yo/...`); payouts → Server Actions with `setPrivateKeyContent(process.env.YO_PRIVATE_KEY!.replace(/\\n/g, "\n"))` since serverless hosts have no key files. See `examples/nextjs/` for every operation, covered by `tests/nextjs.test.ts`.

### Error handling

Transport-level and protocol-level failures throw `YoAPIError` (an `Error` subclass):

```ts
import { YoAPI, YoAPIError } from "@herberthtk/yo-payments-api";

try {
  await yoAPI.acAcctBalance();
} catch (e) {
  if (e instanceof YoAPIError) {
    console.error(e.message, "status:", e.status, "cause:", e.cause);
  }
}
```

`YoAPIError` fields: `message` (what failed), `status?: number` (HTTP status when a response was received), `body?: string` (first 500 chars of the response, when any), `cause?: unknown` (the underlying fetch error). Thrown for connection errors, timeouts, non-2xx HTTP statuses, oversized bodies, malformed XML and responses missing the `<Response>` node. Gateway-level business failures (e.g. `Status: "FAILED"`) are still returned as normal response objects, exactly like the PHP library.

### Examples

The `examples/` directory ports the PHP examples (plus balance and KYC extras); each exports testable functions and is runnable with `bun run`:

```bash
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds_nonblocking.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/get_ministatement.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/get_account_balance.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/get_user_info.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox \
  YO_PRIVATE_KEY_FILE=/path/to/private-key.pem \
  bun run examples/withdraw_funds_public_key_authentication.ts
```

`examples/receive_payment_notification.ts` and `examples/receive_payment_failure_notification.ts` export `handlePaymentNotification` / `handlePaymentFailureNotification` for wiring into your HTTP server. All examples are covered by `tests/examples.test.ts`.

## Notes on parity with the PHP library

- Request XML element order and optional-element inclusion rules match the PHP library exactly (values are inserted verbatim — escape special XML characters yourself, as with the PHP version). Empty-string and `"0"` response fields follow PHP's `empty()` semantics.
- `acUserPurchaseAirtimestock` sends `external_reference` inside a `<TransactionReference>` tag, exactly like the PHP code.
- The PHP library's private `deposit_transaction_type` (used by `acTransactionCheckStatus`) has no setter in PHP and is stuck on `"PULL"`; this port adds `setDepositTransactionType` / `getDepositTransactionType` so `"PUSH"` is usable.
- A `ResultSetLimit` of `0` is sent to the gateway (returns all, per gateway docs). The PHP example passes `0` but its `!= NULL` check silently drops it; this port sends it.
- Timeouts default to 120 s (`setTimeout` / `getTimeout` can change it); a timeout `<= 0` disables the timeout, mirroring PHP curl semantics.
- **TLS verification differs from PHP on purpose:** the PHP library disables peer verification, but this port verifies the gateway certificate by default. Opt out only for testing via `setTlsVerificationEnabled(false)` (on Node.js this additionally requires `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- Response bodies are capped (`setMaxResponseBytes` / `getMaxResponseBytes`, default 1 MiB) and malformed/non-XML responses throw `YoAPIError` instead of degrading to empty results.
- Pass money amounts as strings when exact formatting matters; numbers use JavaScript float-to-string conversion.
- One `YoAPI` instance holds per-request state (`externalReference`, ...), so don't share an instance across concurrent requests — create one per request.
- The Yo! Uganda public certificates (`certs/*.crt`, copied from the PHP package) verify IPN signatures, with embedded copies as fallback when the files can't be resolved (bundled servers, CJS builds). Override with `setPublicKeyFileUrl`. Verification is fail-closed (`is_verified: false`) when the certificate is missing or invalid — monitor this, and handle IPNs idempotently on `external_ref` since notifications carry no replay protection.
- `setPrivateKeyContent` accepts the signing key as PEM text (takes precedence over the file location) for hosts without a stable filesystem; on serverless, load it from an env var and unescape newlines.

## Develop

```bash
bun install
bun test          # mock gateway server + generated RSA keys; no real API calls
bun run typecheck # tsc --noEmit
bun run build     # tsup → dist/ (ESM + CJS + .d.ts); regenerates src/embeddedCerts.ts first
bunx attw --pack  # validate the packed types
```

The suite (`tests/YoAPI.test.ts`, `tests/examples.test.ts`, `tests/keys.test.ts`, `tests/nextjs.test.ts`) asserts byte-exact request XML for every operation, response parsing, signature round-trips, key/cert handling and all examples. `tsc --noEmit` must also pass.

### Releasing (maintainers)

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major). Before the first release, configure npm trusted publishing for `@herberthtk/yo-payments-api` in npm package settings: select GitHub Actions, set the repository to `herberthk/yo-payments-api`, and set the workflow filename to `release.yml` (not its full path). See npm's [trusted publishers guide](https://docs.npmjs.com/trusted-publishers/) for the full setup. Then run **Actions → Release → Run workflow** — release-it bumps the version, updates `CHANGELOG.md`, tags, creates the GitHub release and publishes to npm via trusted publishing (no npm token needed).

## Project structure

- `src/YoAPI.ts` — the `YoAPI` client class (public API: config, operations, notifications, signing)
- `src/types.ts` — public response/body TypeScript interfaces
- `src/errors.ts` — `YoAPIError`
- `src/xml.ts` — request building, response parsing and PHP-parity mapping helpers
- `src/http.ts` — gateway POST transport (timeout, TLS, size cap, error mapping)
- `src/keys.ts` — cached verification-key loading (file-first, embedded fallback)
- `src/constants.ts` — gateway URLs, certificate names, defaults
- `src/embeddedCerts.ts` — auto-generated from `certs/` (`bun run embed-certs`)
- `examples/` — runnable ports of the PHP examples (plus balance and KYC extras)
- `examples/nextjs/` — Next.js App Router handlers, Server Actions and queries
- `certs/` — Yo! Uganda public certificates for IPN verification
- `.github/workflows/` — `ci.yml` (test/typecheck/build/pack-check) and `release.yml` (release-it via trusted publishing)
- `scripts/embed-certs.ts` — regenerates `src/embeddedCerts.ts`

This project was created using `bun init` in bun v1.4.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
