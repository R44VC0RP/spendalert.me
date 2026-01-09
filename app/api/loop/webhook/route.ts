import { NextRequest, NextResponse } from "next/server";
import type { LoopWebhookPayload, LoopWebhookResponse } from "@/lib/loop";
import { sendTransactionAlert } from "@/lib/loop";
import {
  getOrCreateConversation,
  generateResponse,
  saveMessage,
} from "@/lib/ai/agent";

export async function POST(request: NextRequest) {
  try {
    const payload: LoopWebhookPayload = await request.json();

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

      // Get or create conversation for this phone number
      const conversationId = await getOrCreateConversation(phoneNumber);

      // Save the user's message
      await saveMessage(
        conversationId,
        "user",
        userMessage,
        payload.message_id
      );

      // Create a message sender function for interim messages
      const sendInterimMessage = async (message: string) => {
        try {
          const result = await sendTransactionAlert(phoneNumber, message);
          // Save interim messages to conversation history too
          await saveMessage(conversationId, "assistant", message, result.message_id);
          console.log("Sent interim message:", { messageId: result.message_id });
        } catch (e) {
          console.error("Failed to send interim message:", e);
        }
      };

      // Generate AI response (with ability to send interim messages)
      const aiResponse = await generateResponse(conversationId, userMessage, sendInterimMessage);

      // Save the AI's final response
      await saveMessage(conversationId, "assistant", aiResponse);

      // Send the final response via Loop
      const sendResult = await sendTransactionAlert(phoneNumber, aiResponse);

      console.log("Sent AI response:", {
        messageId: sendResult.message_id,
        success: sendResult.success,
      });

      // Return read status to mark conversation as read
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

    // Handle reactions (optional: could trigger AI response)
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
