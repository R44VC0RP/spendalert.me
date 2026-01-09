import { NextRequest, NextResponse } from "next/server";
import type { LoopWebhookPayload, LoopWebhookResponse } from "@/lib/loop";
import { sendTransactionAlert, sendReaction } from "@/lib/loop";
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
  imageUrls?: string[];
  isReaction?: boolean;
  reactionType?: string;
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

    // Handle inbound messages from users (text, images, etc.)
    if (payload.event === "message_inbound") {
      const userMessage = payload.text || "";
      const phoneNumber = payload.contact;
      const imageUrls = payload.attachments;

      if (!phoneNumber) {
        return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
      }

      // Must have either text or images
      if (!userMessage && (!imageUrls || imageUrls.length === 0)) {
        return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
      }

      // Buffer the message and schedule processing
      await bufferMessage(phoneNumber, userMessage, payload.message_id, imageUrls);

      // Return immediately - processing happens after debounce
      return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
    }

    // Handle reactions from users
    if (payload.event === "message_reaction") {
      const phoneNumber = payload.contact;
      // Get reaction type from the payload (can be in reaction_type or reaction field)
      const reactionType = payload.reaction_type || payload.reaction;
      const reactionDirection = payload.reaction_direction;
      
      console.log("Reaction details:", { reactionType, reactionDirection, phoneNumber });
      
      // Only process inbound reactions (from user to us)
      if (reactionDirection === "inbound" && phoneNumber && reactionType) {
        // Buffer the reaction for processing
        await bufferMessage(
          phoneNumber, 
          `[User reacted with ${reactionType} to your message]`, 
          payload.message_id,
          undefined,
          true,
          reactionType
        );
      }
      
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
  messageId: string,
  imageUrls?: string[],
  isReaction?: boolean,
  reactionType?: string
): Promise<void> {
  const now = Date.now();
  const processingTime = new Date(now + DEBOUNCE_DELAY_MS);

  const newMessage: BufferedMessage = {
    text,
    messageId,
    timestamp: now,
    imageUrls,
    isReaction,
    reactionType,
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

  // Combine all text messages into one
  const combinedText = messages.map((m) => m.text).filter(Boolean).join("\n");
  
  // Collect all image URLs
  const allImageUrls = messages.flatMap((m) => m.imageUrls || []);
  
  // Check if any message is a reaction
  const hasReaction = messages.some((m) => m.isReaction);
  const reactionType = messages.find((m) => m.isReaction)?.reactionType;
  
  // Get the last message ID for reacting back
  const lastMessageId = messages[messages.length - 1].messageId;

  console.log(`Processing ${messages.length} buffered messages for ${phoneNumber}:`, {
    text: combinedText,
    images: allImageUrls.length,
    hasReaction,
    reactionType,
  });

  // Get or create conversation
  const conversationId = await getOrCreateConversation(phoneNumber);

  // Save the combined user message (include image info if present)
  const savedMessageContent = allImageUrls.length > 0 
    ? `${combinedText}\n[Images: ${allImageUrls.join(", ")}]`
    : combinedText;
  
  await saveMessage(
    conversationId,
    "user",
    savedMessageContent || "[User sent content]",
    lastMessageId
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
  
  // Create a reaction sender function
  const sendReactionFn = async (
    messageId: string, 
    reaction: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question"
  ) => {
    try {
      const result = await sendReaction(phoneNumber, messageId, reaction);
      console.log("Sent reaction:", { messageId, reaction, result });
    } catch (e) {
      console.error("Failed to send reaction:", e);
    }
  };

  // Generate AI response with all the context
  const aiResponse = await generateResponse({
    conversationId,
    userMessage: combinedText,
    imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
    inboundMessageId: lastMessageId,
    isReaction: hasReaction,
    reactionType,
    sendMessageFn: sendInterimMessage,
    sendReactionFn,
  });

  console.log("AI response result:", {
    hasText: !!aiResponse.text,
    didReact: aiResponse.didReact,
    noResponseNeeded: aiResponse.noResponseNeeded,
  });

  // Only send and save if there's a text response
  if (aiResponse.text) {
    // Save the AI's final response
    await saveMessage(conversationId, "assistant", aiResponse.text);

    // Send the final response via Loop
    const sendResult = await sendTransactionAlert(phoneNumber, aiResponse.text);

    console.log("Sent AI response:", {
      messageId: sendResult.message_id,
      success: sendResult.success,
    });
  } else {
    console.log("No text response needed (reaction only or noResponse called)");
  }
}
