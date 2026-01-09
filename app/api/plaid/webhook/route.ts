import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { transactionSyncWorkflow } from "@/workflows/transaction-sync";

// Plaid webhook types
interface PlaidWebhook {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  initial_update_complete?: boolean;
  historical_update_complete?: boolean;
  error?: {
    error_code: string;
    error_message: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const webhook: PlaidWebhook = await request.json();

    console.log("Received Plaid webhook:", {
      type: webhook.webhook_type,
      code: webhook.webhook_code,
      item_id: webhook.item_id,
    });

    // Handle TRANSACTIONS webhooks
    if (webhook.webhook_type === "TRANSACTIONS") {
      switch (webhook.webhook_code) {
        case "SYNC_UPDATES_AVAILABLE":
          // Start the transaction sync workflow
          // This runs asynchronously and doesn't block the webhook response
          await start(transactionSyncWorkflow, [webhook.item_id]);
          console.log(`[Webhook] Started transaction sync workflow for item: ${webhook.item_id}`);
          break;

        case "INITIAL_UPDATE":
        case "HISTORICAL_UPDATE":
        case "DEFAULT_UPDATE":
          // Legacy webhooks - skip if we're using SYNC_UPDATES_AVAILABLE
          // The cursor-based sync handles these automatically
          console.log(`Skipping legacy webhook ${webhook.webhook_code} - using SYNC_UPDATES_AVAILABLE instead`);
          break;

        case "TRANSACTIONS_REMOVED":
          // Handled via sync - removed transactions come back in sync response
          break;

        default:
          console.log("Unhandled TRANSACTIONS webhook code:", webhook.webhook_code);
      }
    }

    // Handle ITEM webhooks
    if (webhook.webhook_type === "ITEM") {
      switch (webhook.webhook_code) {
        case "ERROR":
          console.error("Plaid Item Error:", webhook.error);
          // Could update item status in DB or notify user
          break;

        case "PENDING_EXPIRATION":
          console.warn("Plaid Item pending expiration:", webhook.item_id);
          // User needs to re-authenticate
          break;

        default:
          console.log("Unhandled ITEM webhook code:", webhook.webhook_code);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
