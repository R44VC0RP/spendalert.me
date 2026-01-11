// WHOOP API client for OAuth and data fetching
// Docs: https://developer.whoop.com/api/

const WHOOP_API_BASE = "https://api.prod.whoop.com";
const WHOOP_AUTH_URL = `${WHOOP_API_BASE}/oauth/oauth2/auth`;
const WHOOP_TOKEN_URL = `${WHOOP_API_BASE}/oauth/oauth2/token`;
const WHOOP_API_URL = `${WHOOP_API_BASE}/developer`;

// All available scopes
export const WHOOP_SCOPES = [
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:body_measurement",
  "offline", // Required for refresh tokens
] as const;

export type WhoopScope = (typeof WHOOP_SCOPES)[number];

// ==========================================
// OAuth Types
// ==========================================

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: "bearer";
  scope: string;
}

// ==========================================
// API Response Types
// ==========================================

export interface WhoopUser {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WhoopBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

export interface WhoopSleepScore {
  stage_summary: {
    total_in_bed_time_milli: number;
    total_awake_time_milli: number;
    total_no_data_time_milli: number;
    total_light_sleep_time_milli: number;
    total_slow_wave_sleep_time_milli: number;
    total_rem_sleep_time_milli: number;
    sleep_cycle_count: number;
    disturbance_count: number;
  };
  sleep_needed: {
    baseline_milli: number;
    need_from_sleep_debt_milli: number;
    need_from_recent_strain_milli: number;
    need_from_recent_nap_milli: number;
  };
  respiratory_rate: number;
  sleep_performance_percentage: number;
  sleep_consistency_percentage: number;
  sleep_efficiency_percentage: number;
}

export interface WhoopSleep {
  id: string;
  cycle_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: WhoopSleepScore;
}

export interface WhoopRecoveryScore {
  user_calibrating: boolean;
  recovery_score: number;
  resting_heart_rate: number;
  hrv_rmssd_milli: number;
  spo2_percentage?: number;
  skin_temp_celsius?: number;
}

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: WhoopRecoveryScore;
}

export interface WhoopCycleScore {
  strain: number;
  kilojoule: number;
  average_heart_rate: number;
  max_heart_rate: number;
}

export interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: WhoopCycleScore;
}

export interface WhoopWorkoutScore {
  strain: number;
  average_heart_rate: number;
  max_heart_rate: number;
  kilojoule: number;
  percent_recorded: number;
  distance_meter?: number;
  altitude_gain_meter?: number;
  altitude_change_meter?: number;
  zone_durations?: {
    zone_zero_milli: number;
    zone_one_milli: number;
    zone_two_milli: number;
    zone_three_milli: number;
    zone_four_milli: number;
    zone_five_milli: number;
  };
}

export interface WhoopWorkout {
  id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number;
  sport_name: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: WhoopWorkoutScore;
}

export interface WhoopPaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

// ==========================================
// Webhook Types
// ==========================================

export type WhoopWebhookType =
  | "recovery.updated"
  | "sleep.updated"
  | "workout.updated"
  | "cycle.updated";

export interface WhoopWebhookPayload {
  type: WhoopWebhookType;
  user_id: number;
  id: string | number; // UUID for sleep/workout, int for cycle/recovery
  trace_id: string;
}

// ==========================================
// OAuth Functions
// ==========================================

/**
 * Generate the OAuth authorization URL to redirect users to
 */
export function getAuthorizationUrl(state: string): string {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_REDIRECT_URI must be set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: WHOOP_SCOPES.join(" "),
    state,
  });

  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access tokens
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<WhoopTokenResponse> {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET || process.env.WHOOP_SECRET;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, and WHOOP_REDIRECT_URI must be set"
    );
  }

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<WhoopTokenResponse> {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET || process.env.WHOOP_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set");
  }

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "offline",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  return response.json();
}

// ==========================================
// API Client
// ==========================================

export class WhoopClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${WHOOP_API_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("WHOOP_TOKEN_EXPIRED");
      }
      const error = await response.text();
      throw new Error(`WHOOP API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  // User endpoints
  async getProfile(): Promise<WhoopUser> {
    return this.request<WhoopUser>("/v2/user/profile/basic");
  }

  async getBodyMeasurements(): Promise<WhoopBodyMeasurement> {
    return this.request<WhoopBodyMeasurement>("/v2/user/measurement/body");
  }

  // Sleep endpoints
  async getSleep(
    sleepId: string
  ): Promise<WhoopSleep> {
    return this.request<WhoopSleep>(`/v2/activity/sleep/${sleepId}`);
  }

  async getSleepCollection(params?: {
    limit?: number;
    start?: string;
    end?: string;
    nextToken?: string;
  }): Promise<WhoopPaginatedResponse<WhoopSleep>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.nextToken) searchParams.set("nextToken", params.nextToken);

    const query = searchParams.toString();
    return this.request<WhoopPaginatedResponse<WhoopSleep>>(
      `/v2/activity/sleep${query ? `?${query}` : ""}`
    );
  }

  // Recovery endpoints
  async getRecovery(cycleId: number): Promise<WhoopRecovery> {
    return this.request<WhoopRecovery>(`/v2/cycle/${cycleId}/recovery`);
  }

  async getRecoveryCollection(params?: {
    limit?: number;
    start?: string;
    end?: string;
    nextToken?: string;
  }): Promise<WhoopPaginatedResponse<WhoopRecovery>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.nextToken) searchParams.set("nextToken", params.nextToken);

    const query = searchParams.toString();
    return this.request<WhoopPaginatedResponse<WhoopRecovery>>(
      `/v2/recovery${query ? `?${query}` : ""}`
    );
  }

  // Cycle endpoints
  async getCycle(cycleId: number): Promise<WhoopCycle> {
    return this.request<WhoopCycle>(`/v2/cycle/${cycleId}`);
  }

  async getCycleCollection(params?: {
    limit?: number;
    start?: string;
    end?: string;
    nextToken?: string;
  }): Promise<WhoopPaginatedResponse<WhoopCycle>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.nextToken) searchParams.set("nextToken", params.nextToken);

    const query = searchParams.toString();
    return this.request<WhoopPaginatedResponse<WhoopCycle>>(
      `/v2/cycle${query ? `?${query}` : ""}`
    );
  }

  // Workout endpoints
  async getWorkout(workoutId: string): Promise<WhoopWorkout> {
    return this.request<WhoopWorkout>(`/v2/activity/workout/${workoutId}`);
  }

  async getWorkoutCollection(params?: {
    limit?: number;
    start?: string;
    end?: string;
    nextToken?: string;
  }): Promise<WhoopPaginatedResponse<WhoopWorkout>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.start) searchParams.set("start", params.start);
    if (params?.end) searchParams.set("end", params.end);
    if (params?.nextToken) searchParams.set("nextToken", params.nextToken);

    const query = searchParams.toString();
    return this.request<WhoopPaginatedResponse<WhoopWorkout>>(
      `/v2/activity/workout${query ? `?${query}` : ""}`
    );
  }
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * Format milliseconds to human readable time
 */
export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get recovery status label based on score
 */
export function getRecoveryStatus(score: number): {
  label: string;
  emoji: string;
} {
  if (score >= 67) {
    return { label: "Green", emoji: "green" };
  } else if (score >= 34) {
    return { label: "Yellow", emoji: "yellow" };
  } else {
    return { label: "Red", emoji: "red" };
  }
}

/**
 * Generate a random state string for OAuth
 */
export function generateState(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
