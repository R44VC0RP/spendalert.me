import { NextRequest, NextResponse } from "next/server";
import type { LoopWebhookPayload, LoopWebhookResponse } from "@/lib/loop";
import { sendTransactionAlert } from "@/lib/loop";
import { db, pendingMessages } from "@/lib/db";
import {
  getOrCreateConversation,
  generateResponse,
  saveMessage,
} from "@/lib/ai/agent";
import { eq, and, isNull, lt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// Debounce delay in milliseconds (wait for more messages)
const DEBOUNCE_DELAY_MS = 2000;

interface BufferedMessage {
  text: string;
  messageId: string;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  try {
    const payload: LoopWebhookPayload = await request.json();

    // Log the ENTIRE payload for debugging (images, reactions, etc.)
    console.log("=== LOOP WEBHOOK FULL PAYLOAD ===");
    console.log(JSON.stringify(payload, null, 2));
    console.log("=== END LOOP WEBHOOK PAYLOAD ===");

    console.log("Received Loop webhook:", {
      event: payload.event,
      contact: payload.contact,
      messageId: payload.message_id,
      text: payload.text,
    });

    // Handle inbound messages from users
    if (payload.event === "message_inbound") {
      const userMessage = payload.text;
      const phoneNumber = payload.contact;

      if (!userMessage || !phoneNumber) {
        return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
      }

      // Buffer the message and schedule processing
      await bufferMessage(phoneNumber, userMessage, payload.message_id);

      // Return immediately - processing happens after debounce
      return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
    }

    // Handle message delivered confirmations
    if (payload.event === "message_delivered") {
      console.log("Message delivered:", {
        messageId: payload.message_id,
        contact: payload.contact,
      });
    }

    // Handle failed messages
    if (payload.event === "message_failed") {
      console.error("Message failed:", {
        messageId: payload.message_id,
        errorCode: payload.error_code,
        contact: payload.contact,
      });
    }

    // Handle reactions
    if (payload.event === "message_reaction") {
      console.log("Reaction received:", {
        reaction: payload.reaction,
        messageId: payload.message_id,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Loop webhook error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Buffer an incoming message and schedule processing after debounce delay
 */
async function bufferMessage(
  phoneNumber: string,
  text: string,
  messageId: string
): Promise<void> {
  const now = Date.now();
  const processingTime = new Date(now + DEBOUNCE_DELAY_MS);

  const newMessage: BufferedMessage = {
    text,
    messageId,
    timestamp: now,
  };

  // Check for existing pending buffer for this phone number
  const existing = await db
    .select()
    .from(pendingMessages)
    .where(
      and(
        eq(pendingMessages.phoneNumber, phoneNumber),
        isNull(pendingMessages.processedAt)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Append to existing buffer and reset processing time
    const buffer = existing[0];
    const messages: BufferedMessage[] = JSON.parse(buffer.messages);
    messages.push(newMessage);

    await db
      .update(pendingMessages)
      .set({
        messages: JSON.stringify(messages),
        processingAt: processingTime,
        updatedAt: new Date(),
      })
      .where(eq(pendingMessages.id, buffer.id));

    console.log(`Appended message to buffer for ${phoneNumber}, now ${messages.length} messages`);
  } else {
    // Create new buffer
    await db.insert(pendingMessages).values({
      id: uuidv4(),
      phoneNumber,
      messages: JSON.stringify([newMessage]),
      processingAt: processingTime,
    });

    console.log(`Created new message buffer for ${phoneNumber}`);
  }

  // Schedule processing (fire and forget - will be picked up by processor)
  // Use setTimeout to trigger processing after debounce delay
  setTimeout(() => {
    processBufferedMessages(phoneNumber).catch((err) => {
      console.error("Error processing buffered messages:", err);
    });
  }, DEBOUNCE_DELAY_MS + 100); // Add small buffer
}

/**
 * Process buffered messages for a phone number
 */
async function processBufferedMessages(phoneNumber: string): Promise<void> {
  const now = new Date();

  // Find buffer that's ready to process
  const buffers = await db
    .select()
    .from(pendingMessages)
    .where(
      and(
        eq(pendingMessages.phoneNumber, phoneNumber),
        isNull(pendingMessages.processedAt),
        lt(pendingMessages.processingAt, now)
      )
    )
    .limit(1);

  if (buffers.length === 0) {
    // Either already processed or not ready yet (more messages came in)
    return;
  }

  const buffer = buffers[0];
  const messages: BufferedMessage[] = JSON.parse(buffer.messages);

  // Mark as processed immediately to prevent duplicate processing
  await db
    .update(pendingMessages)
    .set({ processedAt: now })
    .where(eq(pendingMessages.id, buffer.id));

  // Combine all messages into one
  const combinedText = messages.map((m) => m.text).join("\n");

  console.log(`Processing ${messages.length} buffered messages for ${phoneNumber}:`, combinedText);

  // Get or create conversation
  const conversationId = await getOrCreateConversation(phoneNumber);

  // Save the combined user message
  await saveMessage(
    conversationId,
    "user",
    combinedText,
    messages[messages.length - 1].messageId // Use last message ID
  );

  // Create a message sender function for interim messages
  const sendInterimMessage = async (message: string) => {
    try {
      const result = await sendTransactionAlert(phoneNumber, message);
      await saveMessage(conversationId, "assistant", message, result.message_id);
      console.log("Sent interim message:", { messageId: result.message_id });
    } catch (e) {
      console.error("Failed to send interim message:", e);
    }
  };

  // Generate AI response
  const aiResponse = await generateResponse(conversationId, combinedText, sendInterimMessage);

  // Save the AI's final response
  await saveMessage(conversationId, "assistant", aiResponse);

  // Send the final response via Loop
  const sendResult = await sendTransactionAlert(phoneNumber, aiResponse);

  console.log("Sent AI response:", {
    messageId: sendResult.message_id,
    success: sendResult.success,
  });
}
