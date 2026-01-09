import type { Transaction } from "@/lib/db/schema";
import { sendTransactionAlert } from "@/lib/loop";
import {
  generateSingleTransactionAlert,
  getOrCreateConversation,
  saveMessage,
} from "@/lib/ai/agent";

const ALERT_RECIPIENT = process.env.LOOP_RECIPIENT_PHONE || "+19046086893";

/**
 * Workflow to send a single transaction alert via iMessage.
 * Each transaction gets its own workflow for durability and observability.
 */
export async function sendTransactionAlertWorkflow(tx: Transaction) {
  "use workflow";

  const merchant = tx.merchantName || tx.name;
  const amount = parseFloat(tx.amount);

  console.log(`[Workflow] Sending alert for: $${amount.toFixed(2)} at ${merchant}`);

  // Skip non-spending transactions (should be filtered before, but double-check)
  if (amount <= 0) {
    console.log(`[Workflow] Skipping non-spending transaction: ${merchant}`);
    return { skipped: true, reason: "Non-spending transaction" };
  }

  // Step 1: Generate AI alert message
  const alertMessage = await generateAlertMessage(tx);

  if (!alertMessage) {
    console.log(`[Workflow] AI generated empty alert for ${merchant}, skipping`);
    return { skipped: true, reason: "Empty alert message" };
  }

  // Step 2: Get or create conversation for the recipient
  const conversationId = await getConversation(ALERT_RECIPIENT);

  // Step 3: Send the alert via Loop/iMessage
  const sendResult = await sendAlert(ALERT_RECIPIENT, alertMessage);

  // Step 4: Save to conversation history
  await saveAlertToHistory(conversationId, alertMessage, sendResult.message_id, tx.id);

  console.log(`[Workflow] Alert sent for ${merchant}:`, {
    messageId: sendResult.message_id,
    success: sendResult.success,
  });

  return {
    success: true,
    merchant,
    amount: amount.toFixed(2),
    messageId: sendResult.message_id,
  };
}

// === Steps ===

async function generateAlertMessage(tx: Transaction): Promise<string> {
  "use step";
  
  return generateSingleTransactionAlert(tx);
}

async function getConversation(phoneNumber: string): Promise<string> {
  "use step";
  
  return getOrCreateConversation(phoneNumber);
}

async function sendAlert(recipient: string, message: string) {
  "use step";
  
  return sendTransactionAlert(recipient, message);
}

async function saveAlertToHistory(
  conversationId: string,
  message: string,
  messageId: string,
  transactionId: string
): Promise<void> {
  "use step";
  
  await saveMessage(conversationId, "assistant", message, messageId, transactionId);
}
