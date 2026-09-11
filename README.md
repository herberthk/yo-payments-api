# @herberthtk/yo-payments-api

TypeScript client for the [Yo! Payments API PHP library](https://github.com/YO-Uganda) (`YoAPI.php`) for mobile money, airtime and account operations on the Yo! Payments gateway. Runs on [Bun](https://bun.com) and Node.js 18+ (uses `fetch` + `node:crypto`), including Next.js App Router handlers, Server Actions and Server Components (**server-side only** — never import it into a Client Component).

## Install

```bash
npm install @herberthtk/yo-payments-api
# or: bun add @herberthtk/yo-payments-api
```

## Usage

```ts
import { YoAPI } from "@herberthtk/yo-payments-api";

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
    return new YoAPI(process.env.YO_API_USERNAME!, process.env.YO_API_PASSWORD!, "sandbox");
}
```

```ts
// app/api/yo/ipn/route.ts — register this URL as your InstantNotificationUrl
import "server-only";
import { getYoClient } from "@/lib/yo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const form = await req.formData();
    const body: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") body[k] = v;

    const payment = getYoClient().receivePaymentNotification({
        date_time: body.date_time ?? "",
        amount: body.amount ?? "",
        narrative: body.narrative ?? "",
        network_ref: body.network_ref ?? "",
        external_ref: body.external_ref ?? "",
        msisdn: body.msisdn ?? "",
        signature: body.signature ?? "",
    });
    if (!payment.is_verified) return new Response("NOT VERIFIED", { status: 400 });

    // TODO: persist + mark processed idempotently on payment.external_ref
    return new Response("OK");
}
```

```ts
// app/actions.ts — deposits from a Client Component form action
"use server";
import { getYoClient } from "@/lib/yo";

export async function requestDeposit(msisdn: string, amount: number, narrative: string) {
    const api = getYoClient();
    api.setExternalReference(`${Date.now()}`);
    const res = await api.acDepositFunds(msisdn, amount, narrative);
    if (res.Status === "OK") return { ok: true, reference: res.TransactionReference };
    return { ok: false, message: res.StatusMessage };
}
```

```tsx
// app/statement/page.tsx — Server Component (all reads return JSON-safe data)
import { getYoClient } from "@/lib/yo";

export default async function StatementPage() {
    const res = await getYoClient().acGetMinistatement(null, null, "SUCCEEDED", "UGX-MTNMM", 0);
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

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major). To cut a release, run **Actions → Release → Run workflow** — release-it bumps the version, updates `CHANGELOG.md`, tags, creates the GitHub release and publishes to npm via trusted publishing (no npm token needed). First-time setup only: `npm login` + one manual `npm publish --access public`, then register the repo as a trusted publisher in the npm package settings.

## Project structure

- `src/YoAPI.ts` — the `YoAPI` client class (public API: config, operations, notifications, signing)
- `src/types.ts` — public response/body TypeScript interfaces
- `src/errors.ts` — `YoAPIError`
- `src/xml.ts` — request building, response parsing and PHP-parity mapping helpers
- `src/http.ts` — gateway POST transport (timeout, TLS, size cap, error mapping)
- `src/keys.ts` — cached verification-key loading (file-first, embedded fallback)
- `src/constants.ts` — gateway URLs, certificate names, defaults
- `src/embeddedCerts.ts` — auto-generated from `certs/` (`bun run embed-certs`)
- `examples/` — runnable ports of the six PHP examples
- `examples/nextjs/` — Next.js App Router handlers, Server Actions and queries
- `certs/` — Yo! Uganda public certificates for IPN verification
- `.github/workflows/` — `ci.yml` (test/typecheck/build/pack-check) and `release.yml` (release-it via trusted publishing)
- `scripts/embed-certs.ts` — regenerates `src/embeddedCerts.ts`

This project was created using `bun init` in bun v1.4.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
