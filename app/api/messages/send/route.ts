import { NextRequest, NextResponse } from "next/server";
import { sendMessage } from "@/lib/loop";

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const authHeader = request.headers.get("Authorization");
    const apiKey = process.env.MESSAGES_API_KEY;

    if (!apiKey) {
      console.error("MESSAGES_API_KEY not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const providedKey = authHeader.slice(7); // Remove "Bearer " prefix
    if (providedKey !== apiKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { to, message, imageUrl } = body;

    if (!to) {
      return NextResponse.json(
        { error: "Missing required field: to" },
        { status: 400 }
      );
    }

    if (!message && !imageUrl) {
      return NextResponse.json(
        { error: "Must provide either message or imageUrl" },
        { status: 400 }
      );
    }

    // Validate phone number format (basic E.164 check)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    const cleanPhone = to.replace(/[\s\-\(\)]/g, "");
    if (!phoneRegex.test(cleanPhone)) {
      return NextResponse.json(
        { error: "Invalid phone number format. Use E.164 format (e.g., +19046086893)" },
        { status: 400 }
      );
    }

    // Send the message via Loop (new API doesn't require sender for opted-in contacts)
    const result = await sendMessage({
      contact: cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`,
      text: message || "",
      attachments: imageUrl ? [imageUrl] : undefined,
    });

    return NextResponse.json({
      success: result.success,
      messageId: result.message_id,
      contact: result.contact,
    });
  } catch (error: unknown) {
    console.error("Send message API error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to send message";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
