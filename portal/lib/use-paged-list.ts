'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

export function usePagedList(
  endpoint: string,
  params: Record<string, string>,
  revision?: unknown,
) {
  const [data, setData] = useState<ReturnType<typeof JSON.parse>>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const query = new URLSearchParams(params).toString();
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++requestId.current;
      setLoading(true);
      setError('');
      try {
        const result = await api(`${endpoint}?${query}`, { signal });
        if (!signal?.aborted && current === requestId.current) setData(result);
      } catch (error) {
        if (!signal?.aborted && current === requestId.current)
          setError(errorText(error));
      } finally {
        if (!signal?.aborted && current === requestId.current)
          setLoading(false);
      }
    },
    [endpoint, query],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, revision]);
  return { data, error, loading, load };
}
