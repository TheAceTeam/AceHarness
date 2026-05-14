declare module '@opencode-ai/sdk' {
  interface Session {
    id: string;
    prompt(text: string): AsyncIterable<{ type: string; content?: string }>;
  }

  interface SessionApi {
    create(): Promise<Session>;
    get(id: string): Promise<Session>;
  }

  interface OpencodeClient {
    session: SessionApi;
  }

  export function createOpencode(): OpencodeClient;
}
