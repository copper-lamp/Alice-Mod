/**
 * InstanceFileHelper — 实例入口文件管理
 *
 * 插件首次启动时在 BDS 根目录创建 Alice/ 文件夹，内含：
 * - instance.json   — 实例入口文件（JSON-RPC 发现）
 * - data/           — 数据目录
 *   - instance_id.txt — UUID 持久化
 *
 * 遵循与 TCP 服务端模块一致的握手认证协议。
 * 参考：docs/modules/01-TCP服务端模块.md
 */

// logger 为 LLSE 全局变量，无需导入

// ── 目录路径 ──

const ALICE_DIR = './Alice/';
const DATA_DIR = './Alice/data/';
const INSTANCE_FILE_PATH = './Alice/instance.json';
const INSTANCE_ID_FILE = './Alice/data/instance_id.txt';

// ── 入口文件类型 ──

export interface InstanceFile {
  _schema_version: string;
  instance_id: string;
  mod_version: string;
  game: {
    edition: 'bedrock';
    version: string;
  };
  network: {
    protocol: 'json-rpc-2.0';
    transport: 'tcp';
    host: string;
    port: number;
  };
  status: {
    online: boolean;
    last_seen: string;
  };
  capabilities: {
    tools_count: number;
    max_bots: number;
  };
}

// ── InstanceFileHelper ──

export class InstanceFileHelper {
  /**
   * 确保 Alice/ 目录结构存在
   */
  private static ensureDirectories(): void {
    if (!File.exists(ALICE_DIR)) {
      File.mkdir(ALICE_DIR);
    }
    if (!File.exists(DATA_DIR)) {
      File.mkdir(DATA_DIR);
    }
  }

  /**
   * 生成或更新 Alice/instance.json
   * @param options.tcpClient  TCP 客户端实例（用于获取连接状态和 instanceId）
   * @param options.toolsCount 已注册工具数量
   */
  static generate(options: {
    instanceId: string;
    isConnected: () => boolean;
    toolsCount: number;
  }): boolean {
    this.ensureDirectories();

    // @ts-ignore — LLSE 全局变量
    const serverVersion = mc.getServerVersion() || '1.21.0';

    const instanceFile: InstanceFile = {
      _schema_version: '1.0.0',
      instance_id: options.instanceId,
      mod_version: '1.0.0',
      game: {
        edition: 'bedrock',
        version: serverVersion,
      },
      network: {
        protocol: 'json-rpc-2.0',
        transport: 'tcp',
        host: '127.0.0.1',
        port: 27541,
      },
      status: {
        online: options.isConnected(),
        last_seen: new Date().toISOString(),
      },
      capabilities: {
        tools_count: options.toolsCount,
        max_bots: 3,
      },
    };

    try {
      File.writeTo(INSTANCE_FILE_PATH, JSON.stringify(instanceFile, null, 2));
      logger.info(`[InstanceFile] 已生成: ${INSTANCE_FILE_PATH}`);
      return true;
    } catch (err) {
      logger.error(`[InstanceFile] 写入失败: ${err}`);
      return false;
    }
  }

  /**
   * 加载或创建实例 ID
   * 首次运行时生成 UUID v4，持久化到 Alice/data/instance_id.txt
   * 后续重启直接复用
   */
  static loadOrCreateInstanceId(): string {
    this.ensureDirectories();

    if (File.exists(INSTANCE_ID_FILE)) {
      const id = File.readFrom(INSTANCE_ID_FILE).trim();
      if (id.length > 0) return id;
    }

    // @ts-ignore — LLSE 全局变量
    const uuid = mc.randomGuid();
    File.writeTo(INSTANCE_ID_FILE, uuid);
    logger.info(`[InstanceFile] 已生成实例 ID: ${uuid}`);
    return uuid;
  }

  /**
   * 更新实例状态（连接/断开时调用）
   */
  static updateStatus(options: {
    instanceId: string;
    isConnected: () => boolean;
    toolsCount: number;
  }): boolean {
    return this.generate(options);
  }
}