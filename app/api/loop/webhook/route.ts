import { NextRequest, NextResponse } from "next/server";
import type { LoopWebhookPayload, LoopWebhookResponse } from "@/lib/loop";
import { sendTransactionAlert, sendReaction } from "@/lib/loop";
import { db, pendingMessages } from "@/lib/db";
import {
  getOrCreateConversation,
  generateResponse,
  saveMessage,
} from "@/lib/ai/agent";
import { eq, and, isNull, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";

// How long to wait for more messages before processing (milliseconds)
const DEBOUNCE_MS = 2000;
// Maximum time to wait in the stability loop (milliseconds)
const MAX_WAIT_MS = 30000;
// How often to check for stability (milliseconds)
const CHECK_INTERVAL_MS = 500;

interface ClaimedMessage {
  id: string;
  text: string | null;
  imageUrls: string[] | null;
  isReaction: boolean;
  reactionType: string | null;
  loopMessageId: string;
}

export async function POST(request: NextRequest) {
  try {
    const payload: LoopWebhookPayload = await request.json();

    // Log the ENTIRE payload for debugging
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

      // Process the message with debouncing
      await processInboundMessage({
        phoneNumber,
        text: userMessage || null,
        imageUrls: imageUrls || null,
        loopMessageId: payload.message_id,
        isReaction: false,
        reactionType: null,
      });

      return NextResponse.json({ read: true } satisfies LoopWebhookResponse);
    }

    // Handle reactions from users
    if (payload.event === "message_reaction") {
      const phoneNumber = payload.contact;
      const reactionType = payload.reaction_type || payload.reaction;
      const reactionDirection = payload.reaction_direction;

      console.log("Reaction details:", { reactionType, reactionDirection, phoneNumber });

      // Only process inbound reactions (from user to us)
      if (reactionDirection === "inbound" && phoneNumber && reactionType) {
        await processInboundMessage({
          phoneNumber,
          text: `[User reacted with ${reactionType} to your message]`,
          imageUrls: null,
          loopMessageId: payload.message_id,
          isReaction: true,
          reactionType,
        });
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

interface InboundMessageParams {
  phoneNumber: string;
  text: string | null;
  imageUrls: string[] | null;
  loopMessageId: string;
  isReaction: boolean;
  reactionType: string | null;
}

/**
 * Process an inbound message with debouncing.
 * 1. Insert message into queue
 * 2. Wait for stability (no new messages for DEBOUNCE_MS)
 * 3. Atomically claim all pending messages
 * 4. Process and respond
 */
async function processInboundMessage(params: InboundMessageParams): Promise<void> {
  const { phoneNumber, text, imageUrls, loopMessageId, isReaction, reactionType } = params;

  // Step 1: Insert this message into the queue
  await db.insert(pendingMessages).values({
    id: uuidv4(),
    phoneNumber,
    loopMessageId,
    text,
    imageUrls: imageUrls ? JSON.stringify(imageUrls) : null,
    isReaction,
    reactionType,
  });

  console.log(`[Debounce] Queued message for ${phoneNumber}, waiting for stability...`);

  // Step 2: Wait for stability (no new messages for DEBOUNCE_MS)
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    // Find the newest unprocessed message for this phone
    const newest = await db
      .select({ createdAt: pendingMessages.createdAt })
      .from(pendingMessages)
      .where(
        and(
          eq(pendingMessages.phoneNumber, phoneNumber),
          isNull(pendingMessages.processedAt)
        )
      )
      .orderBy(desc(pendingMessages.createdAt))
      .limit(1);

    if (newest.length === 0) {
      // No unprocessed messages - another webhook already processed everything
      console.log(`[Debounce] No pending messages for ${phoneNumber}, exiting`);
      return;
    }

    const newestTime = newest[0].createdAt.getTime();
    const age = Date.now() - newestTime;

    if (age >= DEBOUNCE_MS) {
      // Stable! Newest message is old enough
      console.log(`[Debounce] Stable for ${phoneNumber}, age=${age}ms`);
      break;
    }

    // Not stable yet, wait a bit
    const waitTime = Math.min(DEBOUNCE_MS - age + 100, CHECK_INTERVAL_MS);
    console.log(`[Debounce] Not stable yet (age=${age}ms), waiting ${waitTime}ms...`);
    await sleep(waitTime);
  }

  // Step 3: Atomically claim all unprocessed messages for this phone
  const claimed = await claimPendingMessages(phoneNumber);

  if (claimed.length === 0) {
    // Another webhook won the race
    console.log(`[Debounce] Another webhook claimed messages for ${phoneNumber}`);
    return;
  }

  console.log(`[Debounce] Claimed ${claimed.length} messages for ${phoneNumber}`);

  // Step 4: Process all claimed messages together
  await processClaimedMessages(phoneNumber, claimed);
}

/**
 * Atomically claim all pending messages for a phone number.
 * Uses UPDATE ... RETURNING to ensure only one webhook wins.
 */
async function claimPendingMessages(phoneNumber: string): Promise<ClaimedMessage[]> {
  const now = new Date();

  // Atomic claim using raw SQL for the UPDATE ... RETURNING pattern
  const result = await db.execute(sql`
    UPDATE pending_messages
    SET processed_at = ${now}
    WHERE phone_number = ${phoneNumber}
      AND processed_at IS NULL
    RETURNING id, text, image_urls, is_reaction, reaction_type, loop_message_id
  `);

  // Map the raw result to our ClaimedMessage type
  const rows = result.rows as Array<{
    id: string;
    text: string | null;
    image_urls: string | null;
    is_reaction: boolean;
    reaction_type: string | null;
    loop_message_id: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    imageUrls: row.image_urls ? JSON.parse(row.image_urls) : null,
    isReaction: row.is_reaction,
    reactionType: row.reaction_type,
    loopMessageId: row.loop_message_id,
  }));
}

/**
 * Process all claimed messages and send a single AI response.
 */
async function processClaimedMessages(
  phoneNumber: string,
  messages: ClaimedMessage[]
): Promise<void> {
  // Combine all text messages
  const combinedText = messages
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n");

  // Collect all image URLs
  const allImageUrls = messages.flatMap((m) => m.imageUrls || []);

  // Check if any message is a reaction
  const hasReaction = messages.some((m) => m.isReaction);
  // Convert null to undefined for the AI agent interface
  const reactionType = messages.find((m) => m.isReaction)?.reactionType ?? undefined;

  // Get the last message ID (for reacting back)
  const lastMessageId = messages[messages.length - 1].loopMessageId;

  console.log(`[Process] Processing ${messages.length} messages for ${phoneNumber}:`, {
    text: combinedText.substring(0, 100),
    images: allImageUrls.length,
    hasReaction,
    reactionType,
  });

  // Get or create conversation
  const conversationId = await getOrCreateConversation(phoneNumber);

  // Save the combined user message
  const savedMessageContent =
    allImageUrls.length > 0
      ? `${combinedText}\n[Images: ${allImageUrls.join(", ")}]`
      : combinedText;

  await saveMessage(
    conversationId,
    "user",
    savedMessageContent || "[User sent content]",
    lastMessageId
  );

  // Create helper functions for AI
  const sendInterimMessage = async (message: string) => {
    try {
      const result = await sendTransactionAlert(phoneNumber, message);
      await saveMessage(conversationId, "assistant", message, result.message_id);
      console.log("Sent interim message:", { messageId: result.message_id });
    } catch (e) {
      console.error("Failed to send interim message:", e);
    }
  };

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

  // Generate AI response
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

  console.log("[Process] AI response result:", {
    hasText: !!aiResponse.text,
    didReact: aiResponse.didReact,
    noResponseNeeded: aiResponse.noResponseNeeded,
  });

  // Send final response if there is one
  if (aiResponse.text) {
    await saveMessage(conversationId, "assistant", aiResponse.text);

    const sendResult = await sendTransactionAlert(phoneNumber, aiResponse.text);

    console.log("[Process] Sent AI response:", {
      messageId: sendResult.message_id,
      success: sendResult.success,
    });
  } else {
    console.log("[Process] No text response (reaction only or noResponse)");
  }
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
