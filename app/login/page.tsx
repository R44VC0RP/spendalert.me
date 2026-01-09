"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (session && !isPending) {
      router.push("/dashboard");
    }
  }, [session, isPending, router]);

  // Check for conditional UI support and preload passkeys
  useEffect(() => {
    const checkConditionalUI = async () => {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        PublicKeyCredential.isConditionalMediationAvailable
      ) {
        const available =
          await PublicKeyCredential.isConditionalMediationAvailable();
        if (available) {
          // Preload passkeys for autofill
          authClient.signIn.passkey({
            autoFill: true,
            fetchOptions: {
              onSuccess: () => {
                router.push("/dashboard");
              },
              onError: (ctx) => {
                // Silent fail for conditional UI - user hasn't selected anything yet
                if (ctx.error.message !== "User cancelled") {
                  console.log("Conditional UI error:", ctx.error.message);
                }
              },
            },
          });
        }
      }
    };
    checkConditionalUI();
  }, [router]);

  const handlePasskeySignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.signIn.passkey({
        fetchOptions: {
          onSuccess: () => {
            router.push("/dashboard");
          },
          onError: (ctx) => {
            setError(ctx.error.message || "Authentication failed");
          },
        },
      });

      if (result.error) {
        setError(result.error.message || "Authentication failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (session) {
    return null; // Will redirect
  }

  return (
    <div className="flex min-h-screen flex-col bg-background safe-area-inset">
      {/* Nav */}
      <nav className="border-b border-border safe-area-top">
        <div className="mx-auto flex h-16 max-w-sm items-center justify-center px-6">
          <span className="text-sm font-medium tracking-tight">SpendAlert</span>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-2 text-lg font-bold">Welcome Back</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Sign In With Your Passkey
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 border border-dashed border-border p-3 text-center text-sm font-medium text-muted-foreground">
            {error}
          </div>
        )}

        {/* Sign In */}
        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            autoComplete="username webauthn"
            className="w-full border border-border bg-background px-4 py-3 text-sm font-medium placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />

          <Button
            onClick={handlePasskeySignIn}
            disabled={isLoading}
            className="w-full font-bold"
            size="lg"
          >
            {isLoading ? "Authenticating..." : "Sign In With Passkey"}
          </Button>
        </div>

        <div className="mt-12 text-center text-xs font-medium text-muted-foreground">
          <p>
            Passkeys use your device&apos;s biometrics (Face ID, Touch ID, etc.)
            for secure, passwordless authentication.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border safe-area-bottom">
        <div className="mx-auto max-w-sm px-6 py-6">
          <div className="text-center text-xs font-medium text-muted-foreground">
            SpendAlert
          </div>
        </div>
      </footer>
    </div>
  );
}
