// Small data layer: cached queries keyed by URL + params, manual invalidation,
// and a mutation helper that maps API errors into form-friendly state.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";

type CacheEntry = { data: unknown; time: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

export function invalidate(prefix?: string) {
  if (!prefix) cache.clear();
  else for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  listeners.forEach((notify) => notify());
}

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
}

export function useApiQuery<T>(
  path: string | null,
  query?: Record<string, string | number | boolean | undefined>,
): QueryState<T> {
  const key = path ? path + "?" + JSON.stringify(query ?? {}) : null;
  const [, force] = useState(0);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: ApiError | null }>(
    () => ({
      data: key && cache.has(key) ? (cache.get(key)!.data as T) : undefined,
      loading: !!key && !cache.has(key),
      error: null,
    }),
  );
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(() => {
    if (!path || !key) return;
    const thisKey = key;
    setState((s) => ({ ...s, loading: true, error: null }));
    const request = (inFlight.get(thisKey) as Promise<T> | undefined) ?? api<T>(path, { query });
    inFlight.set(thisKey, request);
    request
      .then((data) => {
        cache.set(thisKey, { data, time: Date.now() });
        if (keyRef.current === thisKey) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (keyRef.current === thisKey)
          setState((s) => ({
            ...s,
            loading: false,
            error: error instanceof ApiError ? error : new ApiError(0, String(error)),
          }));
      })
      .finally(() => {
        if (inFlight.get(thisKey) === request) inFlight.delete(thisKey);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key) return;
    if (cache.has(key)) setState({ data: cache.get(key)!.data as T, loading: false, error: null });
    else {
      setState({ data: undefined, loading: true, error: null });
      load();
    }
    const onInvalidate = () => {
      if (keyRef.current && !cache.has(keyRef.current)) load();
      else if (keyRef.current) setState({ data: cache.get(keyRef.current)!.data as T, loading: false, error: null });
      force((n) => n + 1);
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data: state.data, loading: state.loading, error: state.error, refresh: load };
}

export interface MutationState<TResult> {
  run: (options?: { onSuccess?: (result: TResult) => void }) => Promise<TResult | undefined>;
  running: boolean;
  error: ApiError | null;
  fieldErrors: Record<string, string>;
  reset: () => void;
}

export function useMutation<TResult = unknown>(
  makeRequest: () => Promise<TResult>,
  invalidatePrefixes: string[] = [],
): MutationState<TResult> {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(
    async (options?: { onSuccess?: (result: TResult) => void }) => {
      if (runningRef.current) return undefined;
      runningRef.current = true;
      setRunning(true);
      setError(null);
      try {
        const result = await makeRequest();
        invalidatePrefixes.forEach((prefix) => invalidate(prefix));
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
        return undefined;
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeRequest],
  );

  return {
    run,
    running,
    error,
    fieldErrors: error?.fieldErrors() ?? {},
    reset: () => setError(null),
  };
}
