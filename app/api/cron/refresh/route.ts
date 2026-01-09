import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts } from "@/lib/db";
import { eq } from "drizzle-orm";

// Platinum card mask to refresh
const PLATINUM_MASK = "1002";

export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.error("Unauthorized cron request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if we're within operating hours (9am - 9pm EST)
    const now = new Date();
    const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = estTime.getHours();
    
    if (hour < 9 || hour >= 21) {
      return NextResponse.json({
        skipped: true,
        message: `Outside operating hours (${hour}:00 EST). Cron runs 9am-9pm EST.`,
      });
    }

    // Find the Platinum account
    const platinumAccount = await db
      .select({
        accountId: plaidAccounts.id,
        itemId: plaidAccounts.itemId,
        accessToken: plaidItems.accessToken,
        institutionName: plaidItems.institutionName,
      })
      .from(plaidAccounts)
      .innerJoin(plaidItems, eq(plaidAccounts.itemId, plaidItems.id))
      .where(eq(plaidAccounts.mask, PLATINUM_MASK))
      .limit(1);

    if (platinumAccount.length === 0) {
      return NextResponse.json({
        error: "Platinum account not found",
        mask: PLATINUM_MASK,
      }, { status: 404 });
    }

    const account = platinumAccount[0];

    // Call Plaid transactions refresh
    await plaidClient.transactionsRefresh({
      access_token: account.accessToken,
    });

    console.log(`[Cron] Refreshed transactions for ${account.institutionName} ...${PLATINUM_MASK}`);

    return NextResponse.json({
      success: true,
      message: `Refreshed ${account.institutionName} ...${PLATINUM_MASK}`,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    console.error("[Cron] Error refreshing transactions:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Cron refresh failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
