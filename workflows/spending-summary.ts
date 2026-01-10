import { sendTransactionAlert } from "@/lib/loop";
import {
  generateSpendingSummary,
  getOrCreateConversation,
  saveMessage,
} from "@/lib/ai/agent";

const ALERT_RECIPIENT = process.env.LOOP_RECIPIENT_PHONE || "+19046086893";

/**
 * Workflow to send a spending summary (midweek or end-of-week).
 * Called by cron jobs on Wednesday and Sunday evenings.
 */
export async function spendingSummaryWorkflow(type: "midweek" | "end-of-week") {
  "use workflow";

  console.log(`[Workflow] Starting ${type} spending summary`);

  // Step 1: Check if we're within reasonable hours (only send during 6-9pm EST)
  const shouldSend = await checkSendingHours();
  if (!shouldSend.withinHours) {
    console.log(`[Workflow] Skipping - outside sending hours (${shouldSend.hour}:00 EST)`);
    return {
      skipped: true,
      reason: `Outside sending hours (${shouldSend.hour}:00 EST)`,
    };
  }

  // Step 2: Generate the summary
  const summary = await generateSummary(type);

  if (!summary) {
    console.log(`[Workflow] AI generated empty summary, skipping`);
    return {
      skipped: true,
      reason: "Empty summary generated",
    };
  }

  // Step 3: Send the summary via iMessage
  const result = await sendSummaryMessage(summary);

  // Step 4: Save to conversation history
  await saveSummaryToConversation(summary, result.messageId);

  console.log(`[Workflow] ${type} summary sent successfully`);

  return {
    success: true,
    type,
    messageId: result.messageId,
    sentAt: new Date().toISOString(),
  };
}

// === Steps ===

async function checkSendingHours() {
  "use step";

  const now = new Date();
  const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estTime.getHours();

  // Only send between 6pm and 9pm EST
  return {
    withinHours: hour >= 18 && hour < 21,
    hour,
    timestamp: now.toISOString(),
  };
}

async function generateSummary(type: "midweek" | "end-of-week"): Promise<string> {
  "use step";

  return generateSpendingSummary(type);
}

async function sendSummaryMessage(summary: string): Promise<{ messageId: string; success: boolean }> {
  "use step";

  const result = await sendTransactionAlert(ALERT_RECIPIENT, summary);
  
  return {
    messageId: result.message_id,
    success: result.success,
  };
}

async function saveSummaryToConversation(summary: string, messageId: string): Promise<void> {
  "use step";

  const conversationId = await getOrCreateConversation(ALERT_RECIPIENT);
  await saveMessage(conversationId, "assistant", summary, messageId);
}
