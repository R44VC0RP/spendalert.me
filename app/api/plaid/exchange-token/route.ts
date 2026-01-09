import { NextRequest, NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { public_token } = await request.json();

    if (!public_token) {
      return NextResponse.json(
        { error: "public_token is required" },
        { status: 400 }
      );
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get item details (institution info)
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });

    const institutionId = itemResponse.data.item.institution_id;
    let institutionName = null;

    if (institutionId) {
      try {
        const institutionResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = institutionResponse.data.institution.name;
      } catch (e) {
        console.warn("Could not fetch institution name:", e);
      }
    }

    // Get accounts
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    // Store item in database
    await db
      .insert(plaidItems)
      .values({
        id: itemId,
        accessToken,
        institutionId,
        institutionName,
      })
      .onConflictDoUpdate({
        target: plaidItems.id,
        set: {
          accessToken,
          institutionId,
          institutionName,
          updatedAt: new Date(),
        },
      });

    // Store accounts in database
    for (const account of accountsResponse.data.accounts) {
      await db
        .insert(plaidAccounts)
        .values({
          id: account.account_id,
          itemId,
          name: account.name,
          officialName: account.official_name,
          type: account.type,
          subtype: account.subtype || null,
          mask: account.mask,
          currentBalance: account.balances.current?.toString(),
          availableBalance: account.balances.available?.toString(),
          isoCurrencyCode: account.balances.iso_currency_code,
        })
        .onConflictDoUpdate({
          target: plaidAccounts.id,
          set: {
            name: account.name,
            officialName: account.official_name,
            type: account.type,
            subtype: account.subtype || null,
            mask: account.mask,
            currentBalance: account.balances.current?.toString(),
            availableBalance: account.balances.available?.toString(),
            isoCurrencyCode: account.balances.iso_currency_code,
            updatedAt: new Date(),
          },
        });
    }

    // Trigger initial transactions sync to activate webhooks
    // This first call activates the SYNC_UPDATES_AVAILABLE webhook
    await plaidClient.transactionsSync({
      access_token: accessToken,
    });

    return NextResponse.json({
      success: true,
      item_id: itemId,
      institution: institutionName,
      accounts: accountsResponse.data.accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        mask: a.mask,
      })),
    });
  } catch (error: unknown) {
    console.error("Error exchanging token:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to exchange token";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
