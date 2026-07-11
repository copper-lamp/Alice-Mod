/**
 * InstanceFileHelper — 实例入口文件管理
 *
 * 遵循 docs/protocols/01-通信协议规范.md 第2章（JSON 入口文件规范）。
 * 模组首次启动时在 Alice/ 目录下生成 mcagent_instance.json，
 * 包含实例标识、网络配置、认证信息、数据库路径、工具集信息。
 */

// logger 为 LLSE 全局变量，无需导入
const crypto = require('crypto');
const path = require('path');

// ── 目录路径 ──

const ALICE_DIR = './Alice/';
const DATA_DIR = './Alice/data/';
const INSTANCE_FILE_PATH = './Alice/mcagent_instance.json';
const INSTANCE_ID_FILE = './Alice/data/instance_id.txt';
const AUTH_TOKEN_FILE = './Alice/data/auth_token.txt';

// ── 入口文件类型（遵循协议规范 schema） ──

export interface ToolCategoryCount {
  category: string;
  count: number;
}

export interface McAgentInstanceFile {
  schema_version: string;
  instance_id: string;
  instance_name: string;
  game_version: {
    edition: 'bedrock' | 'java';
    version: string;
  };
  mod_version: string;
  status: {
    online: boolean;
    last_online: string;
    world_name: string;
  };
  tcp: {
    host: string;
    port: number;
  };
  auth: {
    token: string;
  };
  database: {
    sqlite_path: string;
    chroma_path: string;
    config_path: string;
    log_path: string;
  };
  toolset_info: {
    total_tools: number;
    tool_categories: ToolCategoryCount[];
  };
}

// ── InstanceFileHelper ──

export class InstanceFileHelper {
  /**
   * 获取 BDS 根目录的绝对路径
   */
  private static getBdsRoot(): string {
    // LSE NodeJS 中 process.cwd() 返回 BDS 根目录
    return process.cwd().replace(/\\/g, '/');
  }

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
   * 生成或更新 Alice/mcagent_instance.json
   *
   * @param options.instanceId  实例 UUID
   * @param options.instanceName 实例名称（默认 "McAgent"）
   * @param options.authToken   认证令牌
   * @param options.isConnected TCP 连接状态检测函数
   * @param options.toolCategories 工具分类计数列表
   * @param options.totalTools  工具总数
   */
  static generate(options: {
    instanceId: string;
    instanceName?: string;
    authToken: string;
    isConnected: () => boolean;
    totalTools: number;
    toolCategories: ToolCategoryCount[];
  }): boolean {
    this.ensureDirectories();

    const bdsRoot = this.getBdsRoot();
    const serverVersion = mc.getBDSVersion();
    const worldName = 'Bedrock level'; // LSE NodeJS 无 getLevelName，使用默认值

    const instanceFile: McAgentInstanceFile = {
      schema_version: '1.0.0',
      instance_id: options.instanceId,
      instance_name: options.instanceName || 'McAgent',
      game_version: {
        edition: 'bedrock',
        version: serverVersion,
      },
      mod_version: '1.0.0',
      status: {
        online: options.isConnected(),
        last_online: new Date().toISOString(),
        world_name: worldName,
      },
      tcp: {
        host: '127.0.0.1',
        port: 27541,
      },
      auth: {
        token: options.authToken,
      },
      database: {
        sqlite_path: bdsRoot + '/Alice/data/mcagent.db',
        chroma_path: bdsRoot + '/Alice/data/chroma',
        config_path: bdsRoot + '/Alice/data/config.json',
        log_path: bdsRoot + '/Alice/data/logs',
      },
      toolset_info: {
        total_tools: options.totalTools,
        tool_categories: options.toolCategories,
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

    const uuid = crypto.randomUUID();
    File.writeTo(INSTANCE_ID_FILE, uuid);
    logger.info(`[InstanceFile] 已生成实例 ID: ${uuid}`);
    return uuid;
  }

  /**
   * 加载或创建认证令牌
   * 首次运行时随机生成 mct_ 前缀的令牌，持久化到 Alice/data/auth_token.txt
   * 后续重启直接复用
   */
  static loadOrCreateAuthToken(): string {
    this.ensureDirectories();

    if (File.exists(AUTH_TOKEN_FILE)) {
      const token = File.readFrom(AUTH_TOKEN_FILE).trim();
      if (token.length > 0) return token;
    }

    const randomPart = crypto.randomBytes(16).toString('hex');
    const token = 'mct_' + randomPart;
    File.writeTo(AUTH_TOKEN_FILE, token);
    logger.info(`[InstanceFile] 已生成认证令牌`);
    return token;
  }

  /**
   * 更新实例状态（连接/断开时调用）
   */
  static updateStatus(options: {
    instanceId: string;
    instanceName?: string;
    authToken: string;
    isConnected: () => boolean;
    totalTools: number;
    toolCategories: ToolCategoryCount[];
  }): boolean {
    return this.generate(options);
  }
}