/* Bounded, abortable transport shared by RPC and price requests. */
const Network = (() => {
  class RequestError extends Error {
    constructor(code, message) { super(message); this.name = 'RequestError'; this.code = code; }
  }
  const abortError = () => new DOMException('Cancelled', 'AbortError');
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  async function request(url, init = {}, options = {}) {
    const { signal, timeout = 8000, retries = 1, retryDelay = 400 } = options;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
      let retryAfter = retryDelay * 2 ** attempt;
      try {
        const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) {
          const retryable = [429, 502, 503, 504].includes(response.status);
          const seconds = Number(response.headers.get('retry-after'));
          if (Number.isFinite(seconds) && seconds > 0) retryAfter = Math.min(seconds * 1000, 3000);
          await response.body?.cancel();
          throw new RequestError(retryable ? 'RETRYABLE' : 'HTTP', response.status === 429 ? 'The provider is rate-limiting requests. Retry in a moment.' : 'The provider could not complete this request.');
        }
        // Buffer within the deadline so a stalled response body cannot hang the UI.
        const length = Number(response.headers.get('content-length'));
        if (length > 20 * 1024 * 1024) { await response.body?.cancel(); throw new RequestError('TOO_LARGE', 'The provider response is too large. Narrow the search.'); }
        const chunks = [];
        let total = 0;
        const reader = response.body?.getReader();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > 20 * 1024 * 1024) { await reader.cancel(); throw new RequestError('TOO_LARGE', 'The provider response is too large. Narrow the search.'); }
            chunks.push(value);
          }
        }
        const buffer = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        if (signal?.aborted) throw abortError();
        const retryable = timedOut || error.code === 'RETRYABLE' || error instanceof TypeError;
        if (attempt === retries || !retryable) {
          if (timedOut) throw new RequestError('TIMEOUT', 'The provider took too long to respond. Retry the search.');
          if (error instanceof RequestError) throw error;
          throw new RequestError('NETWORK', 'Could not reach the provider. Check your connection and browser access (CORS).');
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
      await delay(retryAfter, signal);
    }
  }

  async function json(url, init, options) {
    const response = await request(url, init, options);
    try { return await response.json(); }
    catch { throw new RequestError('INVALID_RESPONSE', 'The provider returned an unreadable response.'); }
  }

  return { request, json, RequestError, delay };
})();
