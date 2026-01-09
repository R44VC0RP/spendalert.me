import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";

const isProduction = process.env.NODE_ENV === "production";

// Development origin from inbound.new tunnel
const devOrigin = "https://dev.inbound.new";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || devOrigin,
  trustedOrigins: isProduction ? [] : [devOrigin, "http://localhost:3000"],
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    passkey({
      rpID: isProduction ? "spendalert.me" : "inbound.new",
      rpName: "SpendAlert",
      origin: isProduction ? "https://spendalert.me" : devOrigin,
    }),
    nextCookies(), // must be last
  ],
});

export type Session = typeof auth.$Infer.Session;
