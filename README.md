# yo-api-ts

TypeScript port of the [Yo! Payments API PHP library](https://github.com/YO-Uganda) (`YoAPI.php`) for mobile money, airtime and account operations on the Yo! Payments gateway. Runs on [Bun](https://bun.com) (uses `fetch` + `node:crypto`, so it works in Node 18+ too).

## Install

```bash
bun install
```

## Usage

```ts
import { YoAPI } from "./index.ts";

// production by default; pass "sandbox" as the third argument for sandbox mode
const yoAPI = new YoAPI("API_USERNAME", "API_PASSWORD");

// Request a mobile money user to deposit funds into your account
const response = await yoAPI.acDepositFunds("256770000000", 10000, "Reason for transfer of funds");
if (response.Status === "OK") {
    console.log("Transaction Reference =", response.TransactionReference);
}

// Check the balance of your account
const balance = await yoAPI.acAcctBalance();
console.log(balance.balance); // [{ code: "UGX", balance: "50000" }, ...]
```

All network methods are `async` and return typed response objects. Method names use idiomatic camelCase (e.g. `acDepositFunds`, `setExternalReference`, `getTransactionLimitAccountIdentifier`) — the one intentional divergence from the PHP library's `snake_case` names; the XML wire format is unchanged.

### Available operations

- `acDepositFunds(msisdn, amount, narrative)`
- `acTransactionCheckStatus(transactionReference, privateTransactionReference?)`
- `acInternalTransfer(currencyCode, amount, beneficiaryAccount, beneficiaryEmail, narrative)`
- `acAcctBalance()`
- `acGetMinistatement(startDate?, endDate?, transactionStatus?, currencyCode?, resultSetLimit?, transactionEntryDesignation?, externalReference?)`
- `acSendAirtimeMobile(msisdn, amount, narrative)`
- `acSendAirtimeInternal(currencyCode, amount, beneficiaryAccount, beneficiaryEmail, narrative)`
- `acWithdrawFunds(msisdn, amount, narrative)`
- `acUserPurchaseAirtimestock(airtimeCurrencyCode, amount)`
- `acGetMsisdnKycInfo(msisdn)`
- `generatePublicKeyAuthenticationSignature(msisdn, amount, narrative)`

### Receiving payment notifications (IPN)

PHP reads `$_POST` / `php://input` globals, which is impossible in TypeScript, so you pass the parsed form body yourself. Point `setUrl`-style config is not affected; use `setPublicKeyFileUrl` if you need a different certificate (sandbox vs production is picked automatically by the constructor `mode`).

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
            console.log(`Payment from ${payment.msisdn} of ${payment.amount} (ref ${payment.external_ref})`);
            // update your transaction status where external_ref = payment.external_ref
        }

        // Failure notifications:
        // const failure = yoAPI.receivePaymentFailureNotification(body);
        return new Response("OK");
    },
});
```

### Public key authentication (payouts)

```ts
const yoAPI = new YoAPI("API_USERNAME", "API_PASSWORD");
yoAPI.setExternalReference("INV-123");
yoAPI.setPublicKeyAuthenticationNonce(crypto.randomUUID());
yoAPI.setPrivateKeyFileLocation("/path/to/your-private-key.pem");
yoAPI.generatePublicKeyAuthenticationSignature("256770000000", 5000, "Salary payout");
const res = await yoAPI.acWithdrawFunds("256770000000", 5000, "Salary payout");
```

### Error handling

Transport-level and protocol-level failures throw `YoAPIError` (an `Error` subclass):

```ts
import { YoAPI, YoAPIError } from "./index.ts";

try {
    await yoAPI.acAcctBalance();
} catch (e) {
    if (e instanceof YoAPIError) {
        console.error(e.message, "status:", e.status, "cause:", e.cause);
    }
}
```

`YoAPIError` is thrown for connection errors, timeouts, non-2xx HTTP statuses, oversized bodies, malformed XML and responses missing the `<Response>` node. Gateway-level business failures (e.g. `Status: "FAILED"`) are still returned as normal response objects, exactly like the PHP library.

### Examples

The `examples/` directory ports all six PHP examples; each exports testable functions and is runnable with `bun run`:

```bash
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds_nonblocking.ts
YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/get_ministatement.ts
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
- The Yo! Uganda public certificates (`certs/*.crt`, copied from the PHP package) are used to verify IPN signatures. Verification is fail-closed (`is_verified: false`) when the certificate is missing or invalid — monitor this, and handle IPNs idempotently on `external_ref` since notifications carry no replay protection.

## Develop

```bash
bun install
bun test          # run the test suite (mock gateway server + generated RSA keys; no real API calls)
bun run index.ts
```

The suite (`tests/YoAPI.test.ts`, `tests/examples.test.ts`) asserts byte-exact request XML for every operation, response parsing, signature round-trips and all six ported examples. `tsc --noEmit` (via `bun run typecheck`) must also pass.

## Project structure

- `src/YoAPI.ts` — the `YoAPI` client class (public API: config, operations, notifications, signing)
- `src/types.ts` — public response/body TypeScript interfaces
- `src/errors.ts` — `YoAPIError`
- `src/xml.ts` — request building, response parsing and PHP-parity mapping helpers
- `src/http.ts` — gateway POST transport (timeout, TLS, size cap, error mapping)
- `src/keys.ts` — cached verification-key loading
- `src/constants.ts` — gateway URLs, certificate names, defaults
- `examples/` — runnable ports of the six PHP examples
- `certs/` — Yo! Uganda public certificates for IPN verification

This project was created using `bun init` in bun v1.4.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
