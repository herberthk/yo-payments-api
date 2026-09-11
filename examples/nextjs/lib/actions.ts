/**
 * Server Actions covering every write operation: deposits (+ status checks),
 * internal transfers, airtime, withdrawals and airtime-stock purchases.
 *
 * In your Next.js app, call these from Client Components via form actions —
 * the secrets and the YoAPI client never leave the server. Results are plain
 * JSON-serializable objects, as Server Actions require.
 */
"use server";

import { getYoClient } from "./yo.ts";
import { uniqueReference } from "../../shared.ts";

export interface ActionResult {
    ok: boolean;
    message: string;
    reference?: string;
}

/** Request a mobile money user to deposit funds (USSD PIN prompt flow). */
export async function requestDeposit(msisdn: string, amount: number, narrative: string): Promise<ActionResult> {
    const api = getYoClient();
    const reference = uniqueReference();
    api.setExternalReference(reference);

    const res = await api.acDepositFunds(msisdn, amount, narrative);
    if (res.Status === "OK") {
        return { ok: true, message: "Deposit requested.", reference: res.TransactionReference ?? reference };
    }
    return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
}

/** Check a deposit by the external reference returned from requestDeposit. */
export async function checkDepositStatus(
    privateReference: string,
): Promise<{ status: string; reference: string | null }> {
    const api = getYoClient();
    const res = await api.acTransactionCheckStatus(null, privateReference);
    return { status: res.TransactionStatus, reference: res.TransactionReference ?? null };
}

/** Transfer funds to another Yo! Payments account. */
export async function internalTransfer(input: {
    currencyCode: string;
    amount: number;
    account: number;
    email: string;
    narrative: string;
}): Promise<ActionResult> {
    const api = getYoClient();
    api.setExternalReference(uniqueReference());

    const res = await api.acInternalTransfer(input.currencyCode, input.amount, input.account, input.email, input.narrative);
    if (res.Status === "OK") {
        return { ok: true, message: "Transfer completed.", reference: res.TransactionReference };
    }
    return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
}

/** Send airtime to a mobile phone user. */
export async function sendAirtime(msisdn: string, amount: number, narrative: string): Promise<ActionResult> {
    const api = getYoClient();
    api.setExternalReference(uniqueReference());

    const res = await api.acSendAirtimeMobile(msisdn, amount, narrative);
    if (res.Status === "OK") {
        return { ok: true, message: "Airtime sent.", reference: res.TransactionReference };
    }
    return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
}

/** Send airtime to another Yo! Payments user account. */
export async function sendAirtimeInternal(input: {
    currencyCode: string;
    amount: number;
    account: number;
    email: string;
    narrative: string;
}): Promise<ActionResult> {
    const api = getYoClient();
    api.setExternalReference(uniqueReference());

    const res = await api.acSendAirtimeInternal(
        input.currencyCode,
        input.amount,
        input.account,
        input.email,
        input.narrative,
    );
    if (res.Status === "OK") {
        return { ok: true, message: "Airtime sent.", reference: res.TransactionReference };
    }
    return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
}

/**
 * Withdraw funds to a mobile money user with public key authentication.
 * The private key comes from YO_PRIVATE_KEY (PEM content, \\n-escaped newlines)
 * because serverless hosts have no stable filesystem for key files.
 */
export async function withdrawWithKey(msisdn: string, amount: number, narrative: string): Promise<ActionResult> {
    const api = getYoClient();
    api.setExternalReference(uniqueReference());
    api.setPublicKeyAuthenticationNonce(uniqueReference());

    const keyMaterial = process.env.YO_PRIVATE_KEY ?? "";
    if (!keyMaterial) {
        return { ok: false, message: "Server misconfigured: YO_PRIVATE_KEY is not set." };
    }
    api.setPrivateKeyContent(keyMaterial.replace(/\\n/g, "\n"));

    try {
        api.generatePublicKeyAuthenticationSignature(msisdn, amount, narrative);
        const res = await api.acWithdrawFunds(msisdn, amount, narrative);
        if (res.TransactionStatus === "SUCCEEDED") {
            return { ok: true, message: "Withdrawal completed.", reference: res.TransactionReference };
        }
        return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
    } catch (e) {
        return { ok: false, message: `Yo Payments Error: ${(e as Error).message}` };
    }
}

/** Purchase airtime stock using mobile money credit. */
export async function purchaseAirtimestock(currencyCode: string, amount: number): Promise<ActionResult> {
    const api = getYoClient();
    api.setExternalReference(uniqueReference());

    const res = await api.acUserPurchaseAirtimestock(currencyCode, amount);
    if (res.Status === "OK") {
        return { ok: true, message: "Airtimestock purchased.", reference: res.TransactionReference };
    }
    return { ok: false, message: `Yo Payments Error: ${res.StatusMessage}` };
}
