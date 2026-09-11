export type NonBlocking = "TRUE" | "FALSE";
export type DepositTransactionType = "PULL" | "PUSH";
export type YoMode = "production" | "sandbox";

export interface PaymentNotificationBody {
    date_time: string;
    amount: string;
    narrative: string;
    network_ref: string;
    external_ref: string;
    msisdn: string;
    signature: string;
}

export interface PaymentFailureNotificationBody {
    failed_transaction_reference: string;
    transaction_init_date: string;
    verification: string;
}

export interface PaymentNotificationResult {
    is_verified: boolean;
    date_time: string;
    amount: string;
    narrative: string;
    network_ref: string;
    external_ref: string;
    msisdn: string;
}

export interface PaymentFailureNotificationResult {
    is_verified: boolean;
    failed_transaction_reference: string;
    transaction_init_date: string;
}

export interface DepositFundsResponse {
    Status: string;
    StatusCode: string;
    StatusMessage: string;
    TransactionStatus: string;
    ErrorMessageCode?: string;
    ErrorMessage?: string;
    TransactionReference?: string;
    MNOTransactionReferenceId?: string;
    IssuedReceiptNumber?: string;
}

export interface TransactionCheckStatusResponse extends DepositFundsResponse {
    Amount?: string;
    AmountFormatted?: string;
    CurrencyCode?: string;
    TransactionInitiationDate?: string;
    TransactionCompletionDate?: string;
}

export type InternalTransferResponse = DepositFundsResponse;

export interface BalanceEntry {
    code: string;
    balance: string;
}

export interface AcctBalanceResponse {
    Status: string;
    StatusCode: string;
    balance: BalanceEntry[];
    StatusMessage?: string;
    ErrorMessageCode?: string;
    ErrorMessage?: string;
}

export interface TransactionDetail {
    TransactionSystemId: string;
    TransactionReference: string;
    TransactionStatus: string;
    InitiationDate: string;
    CompletionDate: string;
    NarrativeBase64: string;
    Currency: string;
    Amount: string;
    Balance: string;
    GeneralType: string;
    DetailedType: string;
    BeneficiaryMsisdn?: string;
    BeneficiaryBase64: string;
    SenderMsisdn?: string;
    SenderBase64: string;
    Base64TransactionExternalReference?: string;
    TransactionEntryDesignation: string;
}

export interface MinistatementResponse {
    Status: string;
    StatusCode: string;
    TotalTransactions: string;
    ReturnedTransactions: string;
    Transactions: TransactionDetail[];
    ErrorMessageCode?: string;
    ErrorMessage?: string;
}

export type SendAirtimeResponse = DepositFundsResponse;

export interface PurchaseAirtimeStockResponse {
    Status: string;
    StatusCode: string;
    StatusMessage?: string;
    TransactionReference?: string;
    TotalCurrencyDebited?: string;
    CommissionAmount?: string;
    ErrorMessageCode?: string;
    ErrorMessage?: string;
}

export interface MsisdnKycInfoResponse {
    Status: string;
    StatusCode: string;
    StatusMessage?: string;
    FirstName?: string;
    MiddleName?: string;
    Surname?: string;
}
