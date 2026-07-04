// TCP 客户端占位
// 负责与外部进程（如 JS 插件层）通信

export class TcpClient {
  constructor() {
    // TODO: Initialize TCP connection
  }

  async connect(): Promise<void> {
    // TODO: Connect to host
  }

  async disconnect(): Promise<void> {
    // TODO: Disconnect
  }

  async send(data: Uint8Array): Promise<void> {
    // TODO: Send data
  }

  async receive(): Promise<Uint8Array | null> {
    // TODO: Receive data
    return null;
  }
}
