import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
        <span className="text-sm tracking-tight">spendalert</span>
        <Button variant="ghost" size="sm">
          login
        </Button>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pt-24 pb-32">
        <p className="mb-6 text-xs uppercase tracking-widest text-muted-foreground">
          Your wallet&apos;s conscience
        </p>
        <h1 className="mb-6 text-3xl font-heading font-semibold tracking-tight sm:text-4xl">
          We text you when
          <br />
          you&apos;re spending too much.
        </h1>
        <p className="mb-12 max-w-md text-muted-foreground">
          Connect your bank. Set a limit. Get a text before you blow it. That&apos;s
          it.
        </p>

        {/* Fake SMS preview */}
        <div className="mb-12 max-w-xs">
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              SMS from spendalert
            </p>
            <p className="text-sm">
              Heads up — you&apos;ve spent $847 of your $1,000 monthly budget. You
              have 11 days left.
            </p>
          </div>
          <div className="ml-4 h-4 w-4 -translate-y-px rotate-45 border-b border-r border-border bg-muted/30" />
        </div>

        <div className="flex max-w-sm flex-col gap-3 sm:flex-row">
          <Input
            type="tel"
            placeholder="(555) 123-4567"
            className="h-10 flex-1"
          />
          <Button size="lg" className="h-10">
            Get started
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          $5/mo after 14-day trial. Cancel anytime.
        </p>
      </section>

      {/* The pitch - bank statement style */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mb-12 flex items-baseline justify-between border-b border-dashed border-border pb-4">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              How it works
            </span>
            <span className="text-xs text-muted-foreground">3 steps</span>
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="text-muted-foreground">01</span>
              <span>Link your bank account</span>
              <span className="text-xs text-muted-foreground">256-bit encrypted</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="text-muted-foreground">02</span>
              <span>Set your spending limit</span>
              <span className="text-xs text-muted-foreground">weekly or monthly</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="text-muted-foreground">03</span>
              <span>Receive SMS alerts</span>
              <span className="text-xs text-muted-foreground">at 80%, 90%, 100%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Statement style features */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mb-12 flex items-baseline justify-between border-b border-dashed border-border pb-4">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Account Statement
            </span>
            <span className="text-xs text-muted-foreground">
              Dec 2025
            </span>
          </div>

          <table className="w-full text-sm font-mono tracking-normal">
            <tbody>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 text-muted-foreground">Dec 01</td>
                <td className="py-3">Monthly budget set</td>
                <td className="py-3 text-right">$2,000.00</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 text-muted-foreground">Dec 05</td>
                <td className="py-3">Whole Foods Market</td>
                <td className="py-3 text-right">-$127.43</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 text-muted-foreground">Dec 07</td>
                <td className="py-3">Amazon.com</td>
                <td className="py-3 text-right">-$89.99</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 text-muted-foreground">Dec 09</td>
                <td className="py-3">Shell Gas Station</td>
                <td className="py-3 text-right">-$52.00</td>
              </tr>
              <tr className="border-b border-dashed border-border bg-muted/50">
                <td className="py-3 text-muted-foreground">Dec 11</td>
                <td className="py-3 font-medium">
                  SMS Alert sent — 80% of budget reached
                </td>
                <td className="py-3 text-right">$1,600.00</td>
              </tr>
              <tr>
                <td className="py-3"></td>
                <td className="py-3 text-muted-foreground">Remaining balance</td>
                <td className="py-3 text-right font-medium">$400.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing - receipt style */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mx-auto max-w-xs">
            <div className="border border-dashed border-border p-6 text-center">
              <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                Receipt
              </p>
              <p className="mb-6 text-xs text-muted-foreground">
                --------------------------------
              </p>
              <p className="mb-1 font-mono tracking-normal">spendalert monthly</p>
              <p className="mb-6 text-3xl font-mono tracking-normal">$5.00</p>
              <p className="mb-6 text-xs text-muted-foreground">
                --------------------------------
              </p>
              <div className="mb-6 space-y-1 text-left text-xs font-mono tracking-normal">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unlimited banks</span>
                  <span>incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unlimited SMS</span>
                  <span>incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Weekly reports</span>
                  <span>incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cancel anytime</span>
                  <span>yes</span>
                </div>
              </div>
              <Button className="w-full">Start free trial</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>spendalert</span>
            <div className="flex gap-4">
              <a href="#" className="hover:text-foreground">
                privacy
              </a>
              <a href="#" className="hover:text-foreground">
                terms
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
