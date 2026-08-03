"use client";

import { WS_BASE } from "./config";
import type { WsClientMessage, WsServerEvent } from "./types";

type Handler = (event: WsServerEvent) => void;

export class TalkSocket {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers = new Set<Handler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect(token: string) {
    this.token = token;
    this.intentionalClose = false;
    this.open();
  }

  disconnect() {
    this.intentionalClose = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on(handler: Handler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private open() {
    if (!this.token) return;
    this.clearTimers();
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.pingTimer = setInterval(() => {
        this.send({ type: "ping" });
      }, 25_000);
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as WsServerEvent;
        this.handlers.forEach((h) => h(data));
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onclose = (ev) => {
      this.clearTimers();
      if (ev.code === 4401) {
        this.handlers.forEach((h) =>
          h({ type: "auth.expired", data: {} }),
        );
        return;
      }
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.open(), 2000);
      }
    };
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}

export const talkSocket = new TalkSocket();
