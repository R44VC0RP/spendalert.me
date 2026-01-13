import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts } from "@/lib/db";
import { eq } from "drizzle-orm";

// Platinum card mask to refresh
const PLATINUM_MASK = "1002";

interface RefreshOptions {
  /** If true, skip operating hours check (e.g., triggered by email) */
  fromEmail?: boolean;
}

/**
 * Workflow to refresh Plaid transactions.
 * When triggered by email, runs immediately without operating hours check.
 * When triggered by cron, respects operating hours (9am-9pm EST).
 */
export async function refreshTransactionsWorkflow(options: RefreshOptions = {}) {
  "use workflow";

  const { fromEmail = false } = options;

  // Check operating hours (skip if triggered by email)
  if (!fromEmail) {
    const shouldRun = await checkOperatingHours();
    if (!shouldRun.withinHours) {
      console.log(`[Workflow] Skipping - outside operating hours (${shouldRun.hour}:00 EST)`);
      return { 
        skipped: true, 
        reason: `Outside operating hours (${shouldRun.hour}:00 EST)` 
      };
    }
  } else {
    console.log("[Workflow] Email trigger - skipping operating hours check");
  }

  // Refresh transactions immediately
  const result = await refreshPlaidTransactions();
  
  return {
    success: true,
    fromEmail,
    ...result,
  };
}

/**
 * Check if we're within operating hours (9am - 9pm EST)
 */
async function checkOperatingHours() {
  "use step";
  
  const now = new Date();
  const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estTime.getHours();
  
  return {
    withinHours: hour >= 9 && hour < 21,
    hour,
    timestamp: now.toISOString(),
  };
}

/**
 * Refresh Plaid transactions for the Platinum account
 */
async function refreshPlaidTransactions() {
  "use step";

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
    throw new Error(`Platinum account not found (mask: ${PLATINUM_MASK})`);
  }

  const account = platinumAccount[0];

  // Call Plaid transactions refresh
  await plaidClient.transactionsRefresh({
    access_token: account.accessToken,
  });

  console.log(`[Workflow] Refreshed transactions for ${account.institutionName} ...${PLATINUM_MASK}`);

  return {
    institutionName: account.institutionName,
    accountMask: PLATINUM_MASK,
    refreshedAt: new Date().toISOString(),
  };
}
