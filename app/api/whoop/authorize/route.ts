import { NextResponse } from "next/server";
import { getAuthorizationUrl, generateState } from "@/lib/whoop";
import { cookies } from "next/headers";

export async function GET() {
  try {
    // Generate a random state for CSRF protection
    const state = generateState();

    // Store state in a cookie to verify on callback
    const cookieStore = await cookies();
    cookieStore.set("whoop_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 10, // 10 minutes
      path: "/",
    });

    // Redirect to WHOOP authorization page
    const authUrl = getAuthorizationUrl(state);

    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    console.error("WHOOP authorize error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start authorization";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
