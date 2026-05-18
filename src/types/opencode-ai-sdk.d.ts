declare module '@opencode-ai/sdk' {
  interface ServerHandle {
    url: string;
    close(): void;
  }

  interface Session {
    id: string;
    prompt(text: string): AsyncIterable<{ type: string; content?: string }>;
  }

  interface SessionApi {
    create(options?: {
      body?: Record<string, never>;
      query?: { directory?: string };
    }): Promise<{ data?: { id?: string }; error?: unknown }>;
    get(id: string): Promise<Session>;
    prompt(options: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        variant?: string;
        parts: Array<{ type: 'text'; text: string }>;
      };
      query?: { directory?: string };
    }): Promise<{ data?: unknown; error?: unknown }>;
    promptAsync(options: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        variant?: string;
        parts: Array<{ type: 'text'; text: string }>;
      };
      query?: { directory?: string };
    }): Promise<{ data?: unknown; error?: unknown }>;
  }

  interface EventApi {
    subscribe(options?: {
      signal?: AbortSignal;
      cache?: RequestCache;
      headers?: HeadersInit;
      query?: { directory?: string };
      onSseEvent?: (event: { data?: any }) => void;
      onSseError?: (error: unknown) => void;
    }): Promise<{
      stream?: AsyncIterable<unknown>;
    }>;
  }

  interface OpencodeClient {
    config?: {
      get(options?: Record<string, never>): Promise<{ data?: unknown; error?: unknown }>;
    };
    event?: EventApi;
    session: SessionApi;
  }

  export function createOpencodeClient(options: {
    baseUrl: string;
  }): OpencodeClient;

  export function createOpencode(options?: {
    port?: number;
    hostname?: string;
  }): Promise<{
    client: OpencodeClient;
    server: ServerHandle;
  }>;
}
