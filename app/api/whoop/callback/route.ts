import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, WhoopClient } from "@/lib/whoop";
import { db, whoopTokens } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle OAuth errors
    if (error) {
      console.error("WHOOP OAuth error:", error);
      return NextResponse.redirect(
        new URL(`/?whoop_error=${encodeURIComponent(error)}`, request.url)
      );
    }

    // Validate required params
    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/?whoop_error=missing_params", request.url)
      );
    }

    // Verify state matches what we stored
    const cookieStore = await cookies();
    const storedState = cookieStore.get("whoop_oauth_state")?.value;

    if (!storedState || storedState !== state) {
      console.error("WHOOP OAuth state mismatch:", { storedState, state });
      return NextResponse.redirect(
        new URL("/?whoop_error=invalid_state", request.url)
      );
    }

    // Clear the state cookie
    cookieStore.delete("whoop_oauth_state");

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(code);

    // Get user profile to get WHOOP user ID
    const client = new WhoopClient(tokenResponse.access_token);
    const profile = await client.getProfile();

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Store tokens in database
    await db
      .insert(whoopTokens)
      .values({
        id: profile.user_id.toString(),
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        scopes: tokenResponse.scope,
      })
      .onConflictDoUpdate({
        target: whoopTokens.id,
        set: {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          scopes: tokenResponse.scope,
          updatedAt: new Date(),
        },
      });

    console.log(`[WHOOP] Successfully connected user: ${profile.user_id} (${profile.first_name} ${profile.last_name})`);

    // Redirect to success page
    return NextResponse.redirect(
      new URL(`/?whoop_connected=true&name=${encodeURIComponent(profile.first_name)}`, request.url)
    );
  } catch (error: unknown) {
    console.error("WHOOP callback error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to complete authorization";
    return NextResponse.redirect(
      new URL(`/?whoop_error=${encodeURIComponent(errorMessage)}`, request.url)
    );
  }
}
