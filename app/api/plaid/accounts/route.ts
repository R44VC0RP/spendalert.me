import { NextResponse } from "next/server";
import { db, plaidAccounts, plaidItems } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    // Fetch all accounts with their institution info
    const accounts = await db
      .select({
        id: plaidAccounts.id,
        itemId: plaidAccounts.itemId,
        name: plaidAccounts.name,
        officialName: plaidAccounts.officialName,
        type: plaidAccounts.type,
        subtype: plaidAccounts.subtype,
        mask: plaidAccounts.mask,
        currentBalance: plaidAccounts.currentBalance,
        availableBalance: plaidAccounts.availableBalance,
        isoCurrencyCode: plaidAccounts.isoCurrencyCode,
        institutionName: plaidItems.institutionName,
      })
      .from(plaidAccounts)
      .leftJoin(plaidItems, eq(plaidAccounts.itemId, plaidItems.id));

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        itemId: a.itemId,
        name: a.name,
        officialName: a.officialName,
        type: a.type,
        subtype: a.subtype,
        mask: a.mask,
        currentBalance: a.currentBalance ? parseFloat(a.currentBalance) : null,
        availableBalance: a.availableBalance ? parseFloat(a.availableBalance) : null,
        isoCurrencyCode: a.isoCurrencyCode,
        institutionName: a.institutionName,
        // Display name combines institution + account name + mask
        displayName: `${a.institutionName || "Account"} ${a.name}${a.mask ? ` (...${a.mask})` : ""}`,
      })),
    });
  } catch (error: unknown) {
    console.error("Error fetching accounts:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch accounts";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
