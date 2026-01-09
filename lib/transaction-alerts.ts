import type { Transaction } from "@/lib/db/schema";
import { sendTransactionAlert } from "@/lib/loop";
import {
  generateSingleTransactionAlert,
  getOrCreateConversation,
  saveMessage,
} from "@/lib/ai/agent";

const ALERT_RECIPIENT = process.env.LOOP_RECIPIENT_PHONE || "+19046086893";

// Process new transactions and send individual alerts for each spending transaction
export async function processNewTransactions(
  newTransactions: Transaction[]
): Promise<void> {
  // Filter to only spending transactions (positive amounts in Plaid convention)
  const spending = newTransactions.filter((tx) => parseFloat(tx.amount) > 0);

  if (spending.length === 0) {
    console.log("No spending transactions to alert about");
    return;
  }

  console.log(`Processing ${spending.length} spending transactions for alerts`);

  // Get or create conversation for the recipient (do this once)
  const conversationId = await getOrCreateConversation(ALERT_RECIPIENT);

  // Send individual alerts for each transaction
  for (const tx of spending) {
    try {
      // Generate AI alert message for this single transaction
      const alertMessage = await generateSingleTransactionAlert(tx);

      if (!alertMessage) {
        console.log(`AI generated empty alert for ${tx.merchantName || tx.name}, skipping`);
        continue;
      }

      // Send the alert
      const result = await sendTransactionAlert(ALERT_RECIPIENT, alertMessage);

      // Save the alert message to conversation history
      await saveMessage(
        conversationId,
        "assistant",
        alertMessage,
        result.message_id,
        tx.id
      );

      console.log("Transaction alert sent:", {
        messageId: result.message_id,
        success: result.success,
        merchant: tx.merchantName || tx.name,
        amount: tx.amount,
      });

      // Small delay between messages to avoid rate limiting and keep natural flow
      if (spending.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Failed to send alert for ${tx.merchantName || tx.name}:`, error);
      // Continue with other transactions
    }
  }
}
