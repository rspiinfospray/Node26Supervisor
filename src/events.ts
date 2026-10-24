import type { Response } from "express";
import type { SupervisorEvent } from "./types.js";

export class EventHub {
  private readonly clients = new Set<Response>();
  private readonly history: SupervisorEvent[] = [];
  private nextId = 1;

  public emit(level: SupervisorEvent["level"], type: string, message: string, data?: unknown): SupervisorEvent {
    const event: SupervisorEvent = { id: this.nextId++, timestamp: new Date().toISOString(), level, type, message, data };
    this.history.push(event);
    if (this.history.length > 500) this.history.shift();
    const payload = `id: ${event.id}\nevent: supervisor-event\ndata: ${JSON.stringify(event)}\n\n`;
    this.clients.forEach(client => client.write(payload));
    return event;
  }

  public subscribe(response: Response): void {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    this.clients.add(response);
    this.history.slice(-100).forEach(event => response.write(`id: ${event.id}\nevent: supervisor-event\ndata: ${JSON.stringify(event)}\n\n`));
    response.on("close", () => this.clients.delete(response));
  }

  public recent(): SupervisorEvent[] { return [...this.history]; }
}
