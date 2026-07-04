import type { AppOptions } from './config/index.js';

export class App {
  private options: AppOptions;

  constructor(options: AppOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    // TODO: Initialize TCP client, bot manager, status reporter, etc.
  }

  async stop(): Promise<void> {
    // TODO: Graceful shutdown
  }
}
