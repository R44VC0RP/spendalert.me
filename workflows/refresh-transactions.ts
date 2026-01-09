import { sleep } from "workflow";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts } from "@/lib/db";
import { eq } from "drizzle-orm";

// Platinum card mask to refresh
const PLATINUM_MASK = "1002";

// Max random delay in minutes (0-55 to stay within the hour)
const MAX_DELAY_MINUTES = 55;

/**
 * Workflow to refresh Plaid transactions with a random delay.
 * This makes refresh times unpredictable while still running hourly.
 */
export async function refreshTransactionsWorkflow() {
  "use workflow";

  // Step 1: Check operating hours
  const shouldRun = await checkOperatingHours();
  if (!shouldRun.withinHours) {
    console.log(`[Workflow] Skipping - outside operating hours (${shouldRun.hour}:00 EST)`);
    return { 
      skipped: true, 
      reason: `Outside operating hours (${shouldRun.hour}:00 EST)` 
    };
  }

  // Step 2: Calculate and apply random delay
  const delayMinutes = Math.floor(Math.random() * MAX_DELAY_MINUTES);
  console.log(`[Workflow] Sleeping for ${delayMinutes} minutes before refresh...`);
  
  // Sleep for random duration (doesn't consume resources!)
  await sleep(`${delayMinutes}m`);

  // Step 3: Re-check operating hours after delay
  const afterDelay = await checkOperatingHours();
  if (!afterDelay.withinHours) {
    console.log(`[Workflow] Skipping after delay - now outside operating hours (${afterDelay.hour}:00 EST)`);
    return { 
      skipped: true, 
      reason: `After ${delayMinutes}min delay, now outside operating hours`,
      delayMinutes 
    };
  }

  // Step 4: Refresh transactions
  const result = await refreshPlaidTransactions();
  
  return {
    success: true,
    delayMinutes,
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
