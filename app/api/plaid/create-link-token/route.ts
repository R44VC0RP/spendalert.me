import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient, PLAID_WEBHOOK_URL } from "@/lib/plaid";

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "single-user", // Single user app
      },
      client_name: "SpendAlert",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: PLAID_WEBHOOK_URL,
      transactions: {
        days_requested: 730, // Request up to 2 years of transaction history
      },
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    console.error("Error creating link token:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create link token";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
