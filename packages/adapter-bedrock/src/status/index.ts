// 状态上报占位
// 定期向主控上报插件运行状态

export interface StatusPayload {
  uptime: number;
  botsOnline: number;
  memoryUsage: number;
  // TODO: Add more status fields
}

export class StatusReporter {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number = 5000): void {
    this.intervalHandle = setInterval(() => {
      const payload = this.collect();
      this.report(payload);
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private collect(): StatusPayload {
    return {
      uptime: process.uptime(),
      botsOnline: 0,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  private report(payload: StatusPayload): void {
    // TODO: Send status to host via TCP
    console.debug('[Status]', payload);
  }
}
