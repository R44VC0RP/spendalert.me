import { NextRequest, NextResponse } from "next/server";
import {
  Inbound,
  verifyWebhookFromHeaders,
  type InboundWebhookPayload,
} from "inboundemail";
import { start } from "workflow/api";
import { refreshTransactionsWorkflow } from "@/workflows/refresh-transactions";

// Lazy initialization to avoid build-time errors
let _inbound: Inbound | null = null;
function getInbound(): Inbound {
  if (!_inbound) {
    _inbound = new Inbound({ apiKey: process.env.INBOUND_API_KEY! });
  }
  return _inbound;
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook authenticity
    const isValid = await verifyWebhookFromHeaders(request.headers, getInbound());

    if (!isValid) {
      console.warn("[Inbound Webhook] Verification failed", {
        endpointId: request.headers.get("X-Endpoint-ID"),
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the verified payload
    const payload: InboundWebhookPayload = await request.json();
    const { email, endpoint } = payload;

    console.log("[Inbound Webhook] Received email:", {
      from: email.from.addresses[0]?.address,
      to: email.to.addresses[0]?.address,
      subject: email.subject,
      endpoint: endpoint.name,
    });

    // Trigger a transaction refresh whenever we receive an email
    // This allows bank notification emails to trigger immediate syncs
    await start(refreshTransactionsWorkflow, [{ fromEmail: true }]);

    console.log("[Inbound Webhook] Started refresh workflow (fromEmail: true)");

    return NextResponse.json({
      success: true,
      message: "Refresh workflow triggered",
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[Inbound Webhook] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
