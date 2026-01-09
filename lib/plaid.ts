import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const configuration = new Configuration({
  basePath:
    PlaidEnvironments[
      (process.env.PLAID_ENV as keyof typeof PlaidEnvironments) || "sandbox"
    ],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

// Webhook URL for Plaid to send transaction updates
export const PLAID_WEBHOOK_URL =
  process.env.PLAID_WEBHOOK_URL || "http://localhost:3000/api/plaid/webhook";

// Products to request from Plaid
export const PLAID_PRODUCTS = ["transactions"] as const;

// Country codes for Plaid Link
export const PLAID_COUNTRY_CODES = ["US"] as const;
