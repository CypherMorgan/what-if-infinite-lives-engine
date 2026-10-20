/**
 * Small shared result type. Used anywhere a failure is expected and must be handled by the
 * caller (AI responses, import parsing, migration) instead of thrown.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Unwrap or throw. Only for cases that are genuinely programmer errors after a check. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error));
}

/** Structured, user-presentable error used across the app. */
export interface AppError {
  code: string;
  message: string;
  detail?: string;
  recoverable: boolean;
}

export const appError = (
  code: string,
  message: string,
  detail?: string,
  recoverable = true
): AppError => ({ code, message, ...(detail ? { detail } : {}), recoverable });
