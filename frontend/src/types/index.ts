/** Shared domain types for the CHEX/Nexa client. */

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
  bio?: string;
  /** true only for the permanent master account ("sanjiv"). */
  isAdmin?: boolean;
  [extra: string]: unknown;
}

export interface Tokens {
  accessToken: string | null;
  refreshToken: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export type LoginResult =
  | { requires2FA: true }
  | { requiresPassword2: true }
  | { requires2FA?: false; reactivated?: boolean; user: User };

export type ThemeName = 'light' | 'dark';
