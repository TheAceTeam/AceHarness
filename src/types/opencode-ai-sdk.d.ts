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
      body: { parts: Array<{ type: 'text'; text: string }> };
      query?: { directory?: string };
    }): Promise<{ data?: unknown; error?: unknown }>;
  }

  interface OpencodeClient {
    session: SessionApi;
  }

  export function createOpencode(options?: {
    port?: number;
    hostname?: string;
  }): Promise<{
    client: OpencodeClient;
    server: ServerHandle;
  }>;
}
