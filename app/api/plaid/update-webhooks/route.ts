import { NextRequest, NextResponse } from "next/server";
import { plaidClient, PLAID_WEBHOOK_URL } from "@/lib/plaid";
import { db, plaidItems } from "@/lib/db";

/**
 * POST /api/plaid/update-webhooks
 * Updates the webhook URL for all existing Plaid items.
 * Useful when deploying to a new environment or changing domains.
 * 
 * Requires PLAID_ADMIN_KEY for authentication.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin key
    const authHeader = request.headers.get("authorization");
    const adminKey = process.env.PLAID_ADMIN_KEY;

    if (!adminKey) {
      return NextResponse.json(
        { error: "PLAID_ADMIN_KEY not configured" },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${adminKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all Plaid items
    const items = await db.select().from(plaidItems);

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Plaid items found",
        updated: 0,
        webhookUrl: PLAID_WEBHOOK_URL,
      });
    }

    const results: Array<{
      itemId: string;
      institutionName: string | null;
      success: boolean;
      error?: string;
    }> = [];

    // Update webhook for each item
    for (const item of items) {
      try {
        await plaidClient.itemWebhookUpdate({
          access_token: item.accessToken,
          webhook: PLAID_WEBHOOK_URL,
        });

        results.push({
          itemId: item.id,
          institutionName: item.institutionName,
          success: true,
        });

        console.log(
          `Updated webhook for ${item.institutionName || item.id} to ${PLAID_WEBHOOK_URL}`
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          itemId: item.id,
          institutionName: item.institutionName,
          success: false,
          error: errorMessage,
        });

        console.error(
          `Failed to update webhook for ${item.institutionName || item.id}:`,
          errorMessage
        );
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: failCount === 0,
      message: `Updated ${successCount}/${items.length} items`,
      webhookUrl: PLAID_WEBHOOK_URL,
      updated: successCount,
      failed: failCount,
      results,
    });
  } catch (error: unknown) {
    console.error("Error updating webhooks:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update webhooks";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * GET /api/plaid/update-webhooks
 * Returns the current webhook URL configuration (no auth required for info)
 */
export async function GET() {
  const itemCount = await db.select().from(plaidItems);
  
  return NextResponse.json({
    webhookUrl: PLAID_WEBHOOK_URL,
    itemCount: itemCount.length,
    hint: "POST to this endpoint with Authorization: Bearer <PLAID_ADMIN_KEY> to update all items",
  });
}
