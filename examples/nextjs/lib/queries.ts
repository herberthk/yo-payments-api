/**
 * Server-side read queries: balances, ministatements and MSISDN KYC lookups.
 *
 * Call these from Server Components, Server Actions or Route Handlers — never
 * from Client Components. All return values are plain JSON-serializable data.
 */
import { getYoClient } from "./yo.ts";

export interface BalanceInfo {
    code: string;
    balance: string;
}

/** Current balances of your Yo! Payments account (including airtime). */
export async function getBalances(): Promise<BalanceInfo[]> {
    const res = await getYoClient().acAcctBalance();
    return res.balance;
}

export interface StatementQuery {
    startDate?: string;
    endDate?: string;
    transactionStatus?: string;
    currencyCode?: string;
    resultSetLimit?: number;
    transactionEntryDesignation?: string;
}

/** Transactions for a period (dates as "YYYY-MM-DD HH:MM:SS"). */
export async function getStatement(query: StatementQuery = {}) {
    const res = await getYoClient().acGetMinistatement(
        query.startDate ?? null,
        query.endDate ?? null,
        query.transactionStatus ?? null,
        query.currencyCode ?? null,
        query.resultSetLimit ?? null,
        query.transactionEntryDesignation ?? "ANY",
    );
    return {
        status: res.Status,
        totalTransactions: res.TotalTransactions,
        returnedTransactions: res.ReturnedTransactions,
        transactions: res.Transactions,
    };
}

/** Look up the registered name of a phone number before paying out. */
export async function lookupMsisdn(msisdn: string) {
    const res = await getYoClient().acGetMsisdnKycInfo(msisdn);
    return {
        status: res.Status,
        firstName: res.FirstName ?? null,
        middleName: res.MiddleName ?? null,
        surname: res.Surname ?? null,
    };
}
