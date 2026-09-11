import { createHash, createPrivateKey, sign as rsaSign, verify as rsaVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CERTS_DIR,
    DEFAULT_MAX_RESPONSE_BYTES,
    PRODUCTION_URL,
    PUBLIC_KEY_FILE_FOR_PRODUCTION,
    PUBLIC_KEY_FILE_FOR_SANDBOX,
    SANDBOX_URL,
    defaultVerificationCertificate,
} from "./constants.ts";
import { postXml } from "./http.ts";
import { loadPublicKeyCached } from "./keys.ts";
import type {
    AcctBalanceResponse,
    DepositFundsResponse,
    DepositTransactionType,
    InternalTransferResponse,
    MinistatementResponse,
    MsisdnKycInfoResponse,
    NonBlocking,
    PaymentFailureNotificationBody,
    PaymentFailureNotificationResult,
    PaymentNotificationBody,
    PaymentNotificationResult,
    PurchaseAirtimeStockResponse,
    SendAirtimeResponse,
    TransactionCheckStatusResponse,
    TransactionDetail,
    YoMode,
} from "./types.ts";
import {
    XML_HEADER,
    asArray,
    asRecord,
    el,
    opt,
    parseGatewayResponse,
    setIfNonEmpty,
    setIfNotNull,
    str,
} from "./xml.ts";
import type { XmlNode } from "./xml.ts";

/**
 * Yo! Payments API client (TypeScript port of the official PHP library YoAPI.php).
 *
 * Values are inserted into the request XML verbatim (exactly like the PHP library),
 * so any special XML characters in narratives, references or notification URLs must
 * be escaped by the caller.
 */
export class YoAPI {
    /** The Yo! Payments API Username. Required. */
    private username: string;

    /** The Yo! Payments API Password. Required. */
    private password: string;

    /** Whether the gateway connection is held open until the request completes. Default "FALSE". */
    private nonBlocking: NonBlocking = "FALSE";

    /** An externally agreed reference (e.g. an invoice number). */
    private externalReference: string | null = null;

    /** A reference code related to another Yo! Payments system transaction. */
    private internalReference: string | null = null;

    /** Text appended to the confirmation SMS sent by the mobile money provider. */
    private providerReferenceText: string | null = null;

    /** URL notified as soon as funds are successfully deposited into your account. */
    private instantNotificationUrl: string | null = null;

    /** URL notified as soon as a deposit request fails. */
    private failureNotificationUrl: string | null = null;

    /** May be required to authenticate certain deposit requests. */
    private authenticationSignatureBase64: string | null = null;

    /** "PULL" or "PUSH". Default "PULL". */
    private depositTransactionType: DepositTransactionType = "PULL";

    /** The URL API requests are submitted to. */
    private yoUrl: string = PRODUCTION_URL;

    /** Certificate used to verify IPN signatures (sandbox or production). */
    private publicKeyFile: string;

    /** Whether publicKeyFile is still the bundled default (enables the embedded-cert fallback). */
    private publicKeyFileIsDefault = true;

    private transactionLimitAccountIdentifier: string | null = null;

    /** Unique nonce per request, required when public key authentication is enabled. */
    private publicKeyAuthenticationNonce: string | null = null;

    /** Base64 RSA signature over SHA1(username+amount+account+narrative+external_ref+nonce). */
    private publicKeyAuthenticationSignatureBase64: string | null = null;

    /** Location of the private key used to sign the public key authentication signature. */
    private privateKeyFileLocation: string | null = null;

    /**
     * Private key PEM content used to sign the public key authentication signature.
     * Prefer this over a file location on serverless/bundled hosts where the
     * filesystem is ephemeral (e.g. Vercel). Takes precedence when both are set.
     */
    private privateKeyContent: string | null = null;

    private readonly mode: YoMode;

    /** Request timeout in milliseconds (PHP library uses curl timeout 120s). <= 0 means no timeout, like curl. */
    private timeoutMs: number = 120_000;

    /**
     * Whether to verify the gateway TLS certificate. Default true.
     * The PHP library disables peer verification; this port verifies by default and
     * only skips verification when explicitly opted out via setTlsVerificationEnabled(false).
     */
    private verifyTls: boolean = true;

    /** Maximum accepted gateway response body in bytes (default 1 MiB). */
    private maxResponseBytes: number = DEFAULT_MAX_RESPONSE_BYTES;

    constructor(username: string, password: string, mode: YoMode = "production") {
        this.username = username;
        this.password = password;
        this.mode = mode;

        if (mode === "sandbox") {
            this.yoUrl = SANDBOX_URL;
            this.publicKeyFile = join(CERTS_DIR, PUBLIC_KEY_FILE_FOR_SANDBOX);
        } else {
            this.yoUrl = PRODUCTION_URL;
            this.publicKeyFile = join(CERTS_DIR, PUBLIC_KEY_FILE_FOR_PRODUCTION);
        }
    }

    /** Returns the mode ("production" or "sandbox") this instance was created with. */
    getMode(): YoMode {
        return this.mode;
    }

    /** Set the API Username. */
    setUsername(username: string): void {
        this.username = username;
    }

    /** Returns the API Username. */
    getUsername(): string {
        return this.username;
    }

    /** Set the API Password. */
    setPassword(password: string): void {
        this.password = password;
    }

    /** Returns the API Password. */
    getPassword(): string {
        return this.password;
    }

    /** Set the URL to submit API requests to. */
    setUrl(url: string): void {
        this.yoUrl = url;
    }

    /** Returns the URL API requests are submitted to. */
    getUrl(): string {
        return this.yoUrl;
    }

    /** Set the path of the certificate used to verify IPN signatures. */
    setPublicKeyFileUrl(publicKeyFileUrl: string): void {
        this.publicKeyFile = publicKeyFileUrl;
        this.publicKeyFileIsDefault = false;
    }

    /** Returns the path of the certificate used to verify IPN signatures. */
    getPublicKeyFileUrl(): string {
        return this.publicKeyFile;
    }

    /** Set the NonBlocking variable: "TRUE" for non-blocking API requests. */
    setNonblocking(nonblocking: NonBlocking): void {
        this.nonBlocking = nonblocking;
    }

    /** Returns the NonBlocking variable. */
    getNonblocking(): NonBlocking {
        return this.nonBlocking;
    }

    /** Set the External Reference used when submitting payment requests. */
    setExternalReference(externalReference: string | null): void {
        this.externalReference = externalReference;
    }

    /** Returns the externalReference variable. */
    getExternalReference(): string | null {
        return this.externalReference;
    }

    /** Set the Internal Reference used when submitting payment requests. */
    setInternalReference(internalReference: string | null): void {
        this.internalReference = internalReference;
    }

    /** Returns the internalReference variable. */
    getInternalReference(): string | null {
        return this.internalReference;
    }

    /** Set the Provider Reference Text used when submitting payment requests. */
    setProviderReferenceText(providerReferenceText: string | null): void {
        this.providerReferenceText = providerReferenceText;
    }

    /** Returns the providerReferenceText variable. */
    getProviderReferenceText(): string | null {
        return this.providerReferenceText;
    }

    /** Set the Instant Notification URL (useful for non-blocking requests). */
    setInstantNotificationUrl(instantNotificationUrl: string | null): void {
        this.instantNotificationUrl = instantNotificationUrl;
    }

    /** Returns the instantNotificationUrl variable. */
    getInstantNotificationUrl(): string | null {
        return this.instantNotificationUrl;
    }

    /** Set the Failure Notification URL (useful for non-blocking requests). */
    setFailureNotificationUrl(failureNotificationUrl: string | null): void {
        this.failureNotificationUrl = failureNotificationUrl;
    }

    /** Returns the failureNotificationUrl variable. */
    getFailureNotificationUrl(): string | null {
        return this.failureNotificationUrl;
    }

    /** Set the Authentication Signature Base64. */
    setAuthenticationSignatureBase64(authenticationSignatureBase64: string | null): void {
        this.authenticationSignatureBase64 = authenticationSignatureBase64;
    }

    /** Returns the Authentication Signature Base64 variable. */
    getAuthenticationSignatureBase64(): string | null {
        return this.authenticationSignatureBase64;
    }

    /** Set the Deposit Transaction Type ("PULL" or "PUSH") used by acTransactionCheckStatus. */
    setDepositTransactionType(depositTransactionType: DepositTransactionType): void {
        this.depositTransactionType = depositTransactionType;
    }

    /** Returns the Deposit Transaction Type variable. */
    getDepositTransactionType(): DepositTransactionType {
        return this.depositTransactionType;
    }

    /** Set the Transaction Limit Account Identifier (refer to your account administrator). */
    setTransactionLimitAccountIdentifier(transactionLimitAccountIdentifier: string | null): void {
        this.transactionLimitAccountIdentifier = transactionLimitAccountIdentifier;
    }

    /** Returns the Transaction Limit Account Identifier variable. */
    getTransactionLimitAccountIdentifier(): string | null {
        return this.transactionLimitAccountIdentifier;
    }

    /** Set the Public Key Authentication Nonce (refer to your account administrator). */
    setPublicKeyAuthenticationNonce(publicKeyAuthenticationNonce: string | null): void {
        this.publicKeyAuthenticationNonce = publicKeyAuthenticationNonce;
    }

    /** Returns the Public Key Authentication Nonce variable. */
    getPublicKeyAuthenticationNonce(): string | null {
        return this.publicKeyAuthenticationNonce;
    }

    /** Set the Public Key Authentication Base64-Encoded Signature (refer to your account administrator). */
    setPublicKeyAuthenticationSignatureBase64(publicKeyAuthenticationSignatureBase64: string | null): void {
        this.publicKeyAuthenticationSignatureBase64 = publicKeyAuthenticationSignatureBase64;
    }

    /** Returns the Public Key Authentication Base64-Encoded Signature variable. */
    getPublicKeyAuthenticationSignatureBase64(): string | null {
        return this.publicKeyAuthenticationSignatureBase64;
    }

    /** Set the location of the private key used to sign the public key authentication signature. */
    setPrivateKeyFileLocation(privateKeyFileLocation: string | null): void {
        this.privateKeyFileLocation = privateKeyFileLocation;
    }

    /** Returns the Private Key File variable. */
    getPrivateKeyFileLocation(): string | null {
        return this.privateKeyFileLocation;
    }

    /**
     * Set the private key PEM content directly (alternative to setPrivateKeyFileLocation).
     * Useful where key files are unavailable, e.g. serverless deployments reading
     * the key from an environment variable. Takes precedence when both are set.
     */
    setPrivateKeyContent(privateKeyContent: string | null): void {
        this.privateKeyContent = privateKeyContent;
    }

    /** Returns the Private Key PEM content variable. */
    getPrivateKeyContent(): string | null {
        return this.privateKeyContent;
    }

    /** Set the request timeout in milliseconds. Values <= 0 disable the timeout (like PHP curl timeout 0). */
    setTimeout(timeoutMs: number): void {
        this.timeoutMs = timeoutMs;
    }

    /** Returns the request timeout in milliseconds. */
    getTimeout(): number {
        return this.timeoutMs;
    }

    /**
     * Enable or disable verification of the gateway TLS certificate (default enabled).
     * Disable only for testing against endpoints with self-signed certificates —
     * the PHP library always skips verification.
     * Note: the underlying mechanism is a Bun fetch extension; on Node.js, disabling
     * verification additionally requires NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment.
     */
    setTlsVerificationEnabled(enabled: boolean): void {
        this.verifyTls = enabled;
    }

    /** Returns whether gateway TLS certificate verification is enabled. */
    getTlsVerificationEnabled(): boolean {
        return this.verifyTls;
    }

    /** Set the maximum accepted gateway response body in bytes (default 1048576). */
    setMaxResponseBytes(maxResponseBytes: number): void {
        this.maxResponseBytes = maxResponseBytes;
    }

    /** Returns the maximum accepted gateway response body in bytes. */
    getMaxResponseBytes(): number {
        return this.maxResponseBytes;
    }

    /**
     * Request Mobile Money User to deposit funds into your account.
     * Shortly after submitting, the mobile money user receives an on-screen prompt to
     * authorize the transfer. Not supported by all mobile money operator networks.
     * @param msisdn the mobile money phone number in the format 256772123456
     * @param amount the amount to deposit into your account (fractions supported)
     * @param narrative the reason for the mobile money user to deposit funds
     */
    async acDepositFunds(msisdn: string, amount: number | string, narrative: string): Promise<DepositFundsResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acdepositfunds") +
                el("NonBlocking", this.nonBlocking) +
                el("Account", msisdn) +
                el("Amount", amount) +
                el("Narrative", narrative) +
                opt("ExternalReference", this.externalReference) +
                opt("InternalReference", this.internalReference) +
                opt("ProviderReferenceText", this.providerReferenceText) +
                opt("InstantNotificationUrl", this.instantNotificationUrl) +
                opt("FailureNotificationUrl", this.failureNotificationUrl) +
                opt("AuthenticationSignatureBase64", this.authenticationSignatureBase64),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: DepositFundsResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));
        setIfNonEmpty(result, "TransactionReference", str(response.TransactionReference));
        setIfNonEmpty(result, "MNOTransactionReferenceId", str(response.MNOTransactionReferenceId));
        setIfNonEmpty(result, "IssuedReceiptNumber", str(response.IssuedReceiptNumber));

        return result;
    }

    /**
     * Check the status of a transaction that was earlier submitted for processing.
     * Particularly useful when NonBlocking is "TRUE".
     * @param transactionReference the gateway reference uniquely identifying the transaction
     * @param privateTransactionReference the External Reference used to carry out the transaction
     */
    async acTransactionCheckStatus(
        transactionReference: string | null,
        privateTransactionReference: string | null = null,
    ): Promise<TransactionCheckStatusResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "actransactioncheckstatus") +
                opt("TransactionReference", transactionReference) +
                opt("PrivateTransactionReference", privateTransactionReference) +
                el("DepositTransactionType", this.depositTransactionType),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: TransactionCheckStatusResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));
        setIfNonEmpty(result, "TransactionReference", str(response.TransactionReference));
        setIfNonEmpty(result, "MNOTransactionReferenceId", str(response.MNOTransactionReferenceId));
        setIfNonEmpty(result, "Amount", str(response.Amount));
        setIfNonEmpty(result, "AmountFormatted", str(response.AmountFormatted));
        setIfNonEmpty(result, "CurrencyCode", str(response.CurrencyCode));
        setIfNonEmpty(result, "TransactionInitiationDate", str(response.TransactionInitiationDate));
        setIfNonEmpty(result, "TransactionCompletionDate", str(response.TransactionCompletionDate));
        setIfNonEmpty(result, "IssuedReceiptNumber", str(response.IssuedReceiptNumber));

        return result;
    }

    /**
     * Transfer funds from your Payment Account to another Yo! Payments Account.
     * @param currencyCode e.g. "UGX-MTNMM", "UGX-MTNAT", "UGX-WTLAT", "UGX-OULAT", "UGX-AIRAT"
     * @param amount the amount to be transferred
     * @param beneficiaryAccount account number of the beneficiary Yo! Payments user
     * @param beneficiaryEmail email address of the recipient of funds
     * @param narrative textual narrative about the transaction
     */
    async acInternalTransfer(
        currencyCode: string,
        amount: number | string,
        beneficiaryAccount: number | string,
        beneficiaryEmail: string,
        narrative: string,
    ): Promise<InternalTransferResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acinternaltransfer") +
                el("CurrencyCode", currencyCode) +
                el("Amount", amount) +
                el("BeneficiaryAccount", beneficiaryAccount) +
                el("BeneficiaryEmail", beneficiaryEmail) +
                el("Narrative", narrative) +
                opt("InternalReference", this.internalReference) +
                opt("ExternalReference", this.externalReference),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: InternalTransferResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));
        setIfNonEmpty(result, "TransactionReference", str(response.TransactionReference));
        setIfNonEmpty(result, "MNOTransactionReferenceId", str(response.MNOTransactionReferenceId));
        setIfNonEmpty(result, "IssuedReceiptNumber", str(response.IssuedReceiptNumber));

        return result;
    }

    /**
     * Get the current balance of your Yo! Payments Account.
     * The returned object contains an array of balances (including airtime).
     */
    async acAcctBalance(): Promise<AcctBalanceResponse> {
        const xml = this.requestXml(this.authXml() + el("Method", "acacctbalance"));

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: AcctBalanceResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            balance: [],
        };

        const currencies = asArray(asRecord(asRecord(response.Balance).Currency));
        for (const currency of currencies) {
            const node = asRecord(currency);
            result.balance.push({ code: str(node.Code), balance: str(node.Balance) });
        }

        setIfNonEmpty(result, "StatusMessage", str(response.StatusMessage));
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));

        return result;
    }

    /**
     * Return transactions carried out on your account for a certain period of time.
     * @param startDate format YYYY-MM-DD HH:MM:SS
     * @param endDate format YYYY-MM-DD HH:MM:SS
     * @param transactionStatus e.g. "FAILED", "PENDING", "INDETERMINATE", "SUCCEEDED", "FAILED,SUCCEEDED"
     * @param currencyCode e.g. "UGX-MTNMM", "UGX-WARIDMM", "UGX-MTNAT", "UGX-WTLAT", "UGX-OULAT", "UGX-AIRAT"
     * @param resultSetLimit a value of 0 returns all; default gateway limit = 15
     * @param transactionEntryDesignation "TRANSACTION", "CHARGES" or "ANY"
     * @param externalReference filter using this external reference
     */
    async acGetMinistatement(
        startDate: string | null = null,
        endDate: string | null = null,
        transactionStatus: string | null = null,
        currencyCode: string | null = null,
        resultSetLimit: number | null = null,
        transactionEntryDesignation: string = "ANY",
        externalReference: string | null = null,
    ): Promise<MinistatementResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acgetministatement") +
                opt("StartDate", startDate) +
                opt("EndDate", endDate) +
                opt("TransactionStatus", transactionStatus) +
                opt("CurrencyCode", currencyCode) +
                opt("ResultSetLimit", resultSetLimit) +
                el("TransactionEntryDesignation", transactionEntryDesignation) +
                opt("ExternalReference", externalReference),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: MinistatementResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            TotalTransactions: str(response.TotalTransactions),
            ReturnedTransactions: str(response.ReturnedTransactions),
            Transactions: [],
        };

        const transactions = asArray(asRecord(response.Transactions).Transaction);
        for (const transaction of transactions) {
            const node = asRecord(transaction);
            const detail: TransactionDetail = {
                TransactionSystemId: str(node.TransactionSystemId),
                TransactionReference: str(node.TransactionReference),
                TransactionStatus: str(node.TransactionStatus),
                InitiationDate: str(node.InitiationDate),
                CompletionDate: str(node.CompletionDate),
                NarrativeBase64: str(asArray(node.NarrativeBase64)[0]),
                Currency: str(node.Currency),
                Amount: str(node.Amount),
                Balance: str(node.Balance),
                GeneralType: str(node.GeneralType),
                DetailedType: str(node.DetailedType),
                BeneficiaryBase64: str(node.BeneficiaryBase64),
                SenderBase64: str(node.SenderBase64),
                TransactionEntryDesignation: str(node.TransactionEntryDesignation),
            };
            setIfNonEmpty(detail, "BeneficiaryMsisdn", str(node.BeneficiaryMsisdn));
            setIfNonEmpty(detail, "SenderMsisdn", str(node.SenderMsisdn));
            setIfNonEmpty(detail, "Base64TransactionExternalReference", str(node.Base64TransactionExternalReference));

            result.Transactions.push(detail);
        }

        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));

        return result;
    }

    /**
     * Send airtime to a mobile phone user.
     * @param msisdn the mobile phone number in the format 256772123456
     * @param amount the amount of airtime to be sent to the mobile user
     * @param narrative textual narrative about the transfer
     */
    async acSendAirtimeMobile(msisdn: string, amount: number | string, narrative: string): Promise<SendAirtimeResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acsendairtimemobile") +
                el("NonBlocking", this.nonBlocking) +
                el("Account", msisdn) +
                el("Amount", amount) +
                el("Narrative", narrative) +
                opt("ExternalReference", this.externalReference) +
                opt("InternalReference", this.internalReference) +
                opt("ProviderReferenceText", this.providerReferenceText),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: SendAirtimeResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNotNull(result, "ErrorMessageCode", response.ErrorMessageCode);
        setIfNotNull(result, "ErrorMessage", response.ErrorMessage);
        setIfNotNull(result, "TransactionReference", response.TransactionReference);
        setIfNotNull(result, "MNOTransactionReferenceId", response.MNOTransactionReferenceId);
        setIfNotNull(result, "IssuedReceiptNumber", response.IssuedReceiptNumber);

        return result;
    }

    /**
     * Send airtime from your Yo! Payments account to another Yo! Payments user account.
     * @param currencyCode e.g. "UGX-MTNAT", "UGX-WTLAT", "UGX-OULAT", "UGX-AIRAT"
     * @param amount the amount of airtime to be sent to the beneficiary Yo! Payments user
     * @param beneficiaryAccount the beneficiary Yo! Payments account number
     * @param beneficiaryEmail the beneficiary email address
     * @param narrative textual narrative about the transfer
     */
    async acSendAirtimeInternal(
        currencyCode: string,
        amount: number | string,
        beneficiaryAccount: number | string,
        beneficiaryEmail: string,
        narrative: string,
    ): Promise<SendAirtimeResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acsendairtimeinternal") +
                el("CurrencyCode", currencyCode) +
                el("Amount", amount) +
                el("BeneficiaryAccount", beneficiaryAccount) +
                el("BeneficiaryEmail", beneficiaryEmail) +
                el("Narrative", narrative) +
                opt("InternalReference", this.internalReference) +
                opt("ExternalReference", this.externalReference),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: SendAirtimeResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNotNull(result, "ErrorMessageCode", response.ErrorMessageCode);
        setIfNotNull(result, "ErrorMessage", response.ErrorMessage);
        setIfNotNull(result, "TransactionReference", response.TransactionReference);
        setIfNotNull(result, "MNOTransactionReferenceId", response.MNOTransactionReferenceId);
        setIfNotNull(result, "IssuedReceiptNumber", response.IssuedReceiptNumber);

        return result;
    }

    /**
     * Withdraw funds from your Yo! Payments Account to a mobile money user.
     * Handle with care: if compromised, it can lead to withdrawal of funds from your account.
     * Requires permission granted by the issuance of an API Access Letter.
     * @param msisdn the mobile money phone number in the format 256772123456
     * @param amount the amount to withdraw from your account (fractions supported)
     * @param narrative the reason for withdrawal of funds from your account
     */
    async acWithdrawFunds(msisdn: string, amount: number | string, narrative: string): Promise<DepositFundsResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acwithdrawfunds") +
                el("NonBlocking", this.nonBlocking) +
                el("Account", msisdn) +
                el("Amount", amount) +
                el("Narrative", narrative) +
                opt("ExternalReference", this.externalReference) +
                opt("InternalReference", this.internalReference) +
                opt("ProviderReferenceText", this.providerReferenceText) +
                opt("TransactionLimitAccountIdentifier", this.transactionLimitAccountIdentifier) +
                opt("PublicKeyAuthenticationNonce", this.publicKeyAuthenticationNonce) +
                opt("PublicKeyAuthenticationSignatureBase64", this.publicKeyAuthenticationSignatureBase64),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: DepositFundsResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
            StatusMessage: str(response.StatusMessage),
            TransactionStatus: str(response.TransactionStatus),
        };
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));
        setIfNonEmpty(result, "TransactionReference", str(response.TransactionReference));
        setIfNonEmpty(result, "MNOTransactionReferenceId", str(response.MNOTransactionReferenceId));
        setIfNonEmpty(result, "IssuedReceiptNumber", str(response.IssuedReceiptNumber));

        return result;
    }

    /**
     * Purchase airtime using your Mobile Money Credit.
     * @param airtimeCurrencyCode e.g. "UGX-MTNAT", "UGX-AIRAT", "UGX-OULAT", "UGX-UTLAT", "UGX-SMTAT"
     * @param amount the amount to spend (fractions supported)
     */
    async acUserPurchaseAirtimestock(
        airtimeCurrencyCode: string,
        amount: number | string,
    ): Promise<PurchaseAirtimeStockResponse> {
        const xml = this.requestXml(
            this.authXml() +
                el("Method", "acuserpurchaseairtimestock") +
                el("AirtimeCurrencyCode", airtimeCurrencyCode) +
                el("Amount", amount) +
                // The PHP library sends externalReference inside a TransactionReference tag; kept for parity.
                opt("TransactionReference", this.externalReference),
        );

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: PurchaseAirtimeStockResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
        };
        setIfNonEmpty(result, "StatusMessage", str(response.StatusMessage));
        setIfNonEmpty(result, "TransactionReference", str(response.TransactionReference));
        setIfNonEmpty(result, "TotalCurrencyDebited", str(response.TotalCurrencyDebited));
        setIfNonEmpty(result, "CommissionAmount", str(response.CommissionAmount));
        setIfNonEmpty(result, "ErrorMessageCode", str(response.ErrorMessageCode));
        setIfNonEmpty(result, "ErrorMessage", str(response.ErrorMessage));

        return result;
    }

    /**
     * Obtain the name of a phone number before paying out funds.
     * Only available for MTN Uganda and Airtel Uganda networks; requires permission
     * from support@yo.co.ug.
     * @param msisdn the phone number in the format 2567XXXXXXXXXX
     */
    async acGetMsisdnKycInfo(msisdn: string): Promise<MsisdnKycInfoResponse> {
        const xml = this.requestXml(this.authXml() + el("Method", "acgetmsisdnkycinfo") + el("Msisdn", msisdn));

        const response = asRecord((await this.parseResponse(xml)).Response);

        const result: MsisdnKycInfoResponse = {
            Status: str(response.Status),
            StatusCode: str(response.StatusCode),
        };
        setIfNonEmpty(result, "StatusMessage", str(response.StatusMessage));

        const names = asRecord(asRecord(asRecord(response.AccountInformation).PersonalInformation).Names);
        setIfNonEmpty(result, "FirstName", str(names.FirstName));
        setIfNonEmpty(result, "MiddleName", str(names.MiddleName));
        setIfNonEmpty(result, "Surname", str(names.Surname));

        return result;
    }

    /**
     * Decode and verify a successful payment notification (IPN) POSTed to your
     * Instant Notification URL. Pass the parsed form body of the request.
     */
    receivePaymentNotification(body: PaymentNotificationBody): PaymentNotificationResult {
        return {
            is_verified: this.verifyPaymentNotification(body),
            date_time: body.date_time ?? "",
            amount: body.amount ?? "",
            narrative: body.narrative ?? "",
            network_ref: body.network_ref ?? "",
            external_ref: body.external_ref ?? "",
            msisdn: body.msisdn ?? "",
        };
    }

    /**
     * Decode and verify a failed payment notification POSTed to your
     * Failure Notification URL. Pass the parsed form body of the request.
     */
    receivePaymentFailureNotification(body: PaymentFailureNotificationBody): PaymentFailureNotificationResult {
        return {
            is_verified: this.verifyPaymentFailureNotification(body),
            failed_transaction_reference: body.failed_transaction_reference ?? "",
            transaction_init_date: body.transaction_init_date ?? "",
        };
    }

    /**
     * Calculate the Public Key Authentication Signature required by some payout requests.
     * Sets publicKeyAuthenticationSignatureBase64 on success.
     * @param msisdn the account the funds will be pushed to
     * @param amount the transaction amount
     * @param narrative the transaction narrative
     */
    generatePublicKeyAuthenticationSignature(msisdn: string, amount: number | string, narrative: string): void {
        // Loose check like PHP's `== NULL`: null, undefined and "" are all missing.
        if (!this.publicKeyAuthenticationNonce) {
            throw new Error("Public key authentication nonce is not set. Please set it to continue");
        }

        if (!this.privateKeyFileLocation && this.privateKeyContent === null) {
            throw new Error("Private key file location cannot be NULL");
        }

        let privateKeyPem: string | null = this.privateKeyContent;
        if (privateKeyPem === null) {
            try {
                privateKeyPem = readFileSync(this.privateKeyFileLocation as string, "utf-8");
            } catch {
                throw new Error(
                    `Private key file could not be opened. Confirm your file location ${this.privateKeyFileLocation}`,
                );
            }
        }

        let privateKey;
        try {
            privateKey = createPrivateKey(privateKeyPem);
        } catch {
            throw new Error("Private key is invalid");
        }

        const data =
            this.username +
            String(amount) +
            msisdn +
            narrative +
            (this.externalReference ?? "") +
            this.publicKeyAuthenticationNonce;

        // SHA1 is mandated by the Yo! Payments protocol (mirrors PHP's
        // openssl_sign(..., 'sha1WithRSAEncryption')); do not "upgrade" it.
        const sha1Hex = createHash("sha1").update(data).digest("hex");

        const signature = rsaSign("sha1", Buffer.from(sha1Hex, "utf-8"), privateKey);

        this.publicKeyAuthenticationSignatureBase64 = signature.toString("base64");
    }

    /** POST raw XML to the gateway and return the XML response body. */
    protected async getXmlResponse(xml: string): Promise<string> {
        return postXml(this.yoUrl, xml, {
            timeoutMs: this.timeoutMs,
            verifyTls: this.verifyTls,
            maxResponseBytes: this.maxResponseBytes,
        });
    }

    /** Verify the RSA-SHA256 signature on a payment notification against the Yo public certificate. */
    protected verifyPaymentNotification(body: PaymentNotificationBody): boolean {
        const data =
            (body.date_time ?? "") +
            (body.amount ?? "") +
            (body.narrative ?? "") +
            (body.network_ref ?? "") +
            (body.external_ref ?? "") +
            (body.msisdn ?? "");

        return this.verifySignature(data, body.signature);
    }

    /** Verify the RSA-SHA256 signature on a payment failure notification against the Yo public certificate. */
    protected verifyPaymentFailureNotification(body: PaymentFailureNotificationBody): boolean {
        const data = (body.failed_transaction_reference ?? "") + (body.transaction_init_date ?? "");

        return this.verifySignature(data, body.verification);
    }

    private verifySignature(data: string, signatureBase64: string | undefined): boolean {
        if (!signatureBase64) return false;

        const publicKey = loadPublicKeyCached(
            this.publicKeyFile,
            this.publicKeyFileIsDefault ? defaultVerificationCertificate(this.mode) : undefined,
        );
        if (publicKey === null) return false;

        try {
            return rsaVerify("sha256", Buffer.from(data, "utf-8"), publicKey, Buffer.from(signatureBase64, "base64"));
        } catch {
            return false;
        }
    }

    private authXml(): string {
        return el("APIUsername", this.username) + el("APIPassword", this.password);
    }

    private requestXml(body: string): string {
        return `${XML_HEADER}<AutoCreate><Request>${body}</Request></AutoCreate>`;
    }

    /** POST the request XML to the gateway and return the parsed envelope that holds the <Response> node. */
    private async parseResponse(requestXml: string): Promise<XmlNode> {
        return parseGatewayResponse(await this.getXmlResponse(requestXml));
    }
}

export default YoAPI;
