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
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

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

  const handleEmailSignIn = async () => {
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        fetchOptions: {
          onSuccess: () => {
            router.push("/dashboard");
          },
          onError: (ctx) => {
            setError(ctx.error.message || "Sign in failed");
          },
        },
      });

      if (result.error) {
        setError(result.error.message || "Sign in failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !password || !name) {
      setError("Please fill in all fields");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name,
        fetchOptions: {
          onSuccess: () => {
            router.push("/dashboard");
          },
          onError: (ctx) => {
            setError(ctx.error.message || "Sign up failed");
          },
        },
      });

      if (result.error) {
        setError(result.error.message || "Sign up failed");
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
          <span className="text-sm tracking-tight">spendalert</span>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="mb-2 text-lg font-medium">
            {isSignUp ? "Create account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignUp
              ? "Sign up to get started"
              : "Sign in with your passkey or email"}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
            {error}
          </div>
        )}

        {/* Sign Up Form */}
        {isSignUp ? (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            <Button
              onClick={handleEmailSignUp}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? "Creating account..." : "Sign up"}
            </Button>
            <div className="text-center">
              <button
                onClick={() => {
                  setIsSignUp(false);
                  setError(null);
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Already have an account? Sign in
              </button>
            </div>
          </div>
        ) : (
          /* Sign In Form */
          <div className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username webauthn"
              className="w-full border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password webauthn"
              className="w-full border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            <Button
              onClick={handleEmailSignIn}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? "Signing in..." : "Sign in with Email"}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or
                </span>
              </div>
            </div>
            <Button
              onClick={handlePasskeySignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {isLoading ? "Authenticating..." : "Sign in with Passkey"}
            </Button>
            <div className="text-center">
              <button
                onClick={() => {
                  setIsSignUp(true);
                  setError(null);
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Need an account? Sign up
              </button>
            </div>
          </div>
        )}

        <div className="mt-12 text-center text-xs text-muted-foreground">
          <p>
            {isSignUp
              ? "After signing up, you can add a passkey from your dashboard."
              : "Passkeys use your device's biometrics for secure, passwordless authentication."}
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border safe-area-bottom">
        <div className="mx-auto max-w-sm px-6 py-6">
          <div className="text-center text-xs text-muted-foreground">
            spendalert
          </div>
        </div>
      </footer>
    </div>
  );
}
