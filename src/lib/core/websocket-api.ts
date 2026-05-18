/**
 * WebSocket API - 增量更新方案
 */

type MessageHandler = (data: any) => void;

export class WorkflowWebSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastStatusHash: string = '';

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/api/workflow/ws`);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.send({ type: 'subscribe', events: ['status', 'log', 'step'] });
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting...');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  private handleMessage(data: any) {
    const handlers = this.handlers.get(data.type) || [];
    handlers.forEach(h => h(data));
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
