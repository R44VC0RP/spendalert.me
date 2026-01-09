"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink, PlaidLinkOnSuccess } from "react-plaid-link";
import { Button } from "@/components/ui/button";

interface PlaidLinkButtonProps {
  onSuccess?: (itemId: string, institution: string | null) => void;
  onError?: (error: string) => void;
  variant?: "default" | "icon";
}

export function PlaidLinkButton({ onSuccess, onError, variant = "default" }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);

  // Fetch link token on mount
  useEffect(() => {
    const fetchLinkToken = async () => {
      try {
        const response = await fetch("/api/plaid/create-link-token", {
          method: "POST",
        });
        const data = await response.json();

        if (data.error) {
          onError?.(data.error);
          return;
        }

        setLinkToken(data.link_token);
      } catch (error) {
        console.error("Error fetching link token:", error);
        onError?.(error instanceof Error ? error.message : "Failed to initialize Plaid");
      }
    };

    fetchLinkToken();
  }, [onError]);

  // Handle successful Plaid Link connection
  const handleSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken) => {
      setIsExchanging(true);
      try {
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });

        const data = await response.json();

        if (data.error) {
          onError?.(data.error);
          return;
        }

        onSuccess?.(data.item_id, data.institution);
      } catch (error) {
        console.error("Error exchanging token:", error);
        onError?.(error instanceof Error ? error.message : "Failed to connect account");
      } finally {
        setIsExchanging(false);
      }
    },
    [onSuccess, onError]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: (error) => {
      if (error) {
        console.error("Plaid Link exit error:", error);
        onError?.(error.error_message || "Connection cancelled");
      }
    },
  });

  const handleClick = useCallback(() => {
    setIsLoading(true);
    open();
    // Link modal handles its own loading state
    setTimeout(() => setIsLoading(false), 1000);
  }, [open]);

  if (variant === "icon") {
    return (
      <button
        onClick={handleClick}
        disabled={!ready || isLoading || isExchanging || !linkToken}
        className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
        title="Add account"
      >
        {isExchanging || isLoading || !linkToken ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <Button
      onClick={handleClick}
      disabled={!ready || isLoading || isExchanging || !linkToken}
      variant="default"
      size="lg"
    >
      {isExchanging
        ? "Connecting..."
        : isLoading
        ? "Opening..."
        : !linkToken
        ? "Initializing..."
        : "Connect Bank Account"}
    </Button>
  );
}
