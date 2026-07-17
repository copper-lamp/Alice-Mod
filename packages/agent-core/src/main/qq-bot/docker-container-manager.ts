/**
 * DockerContainerManager — Docker 容器管理 NapCat 实例
 *
 * 替代 NapCatManager 的进程托管模式，通过 Docker SDK (dockerode) 管理 NapCat 容器。
 * 支持容器的拉取、启动、停止、删除、日志流和 QR 扫码登录。
 *
 * 优势：
 * - 跨平台（Win/Mac/Linux）
 * - Docker 守护进程自动管理容器生命周期
 * - 天然多账号隔离（每个容器独立端口映射）
 * - 崩溃自动恢复（--restart=unless-stopped）
 */

import Docker, { type Container } from 'dockerode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

/** 容器运行状态 */
export type ContainerStatus = 'idle' | 'pulling' | 'starting' | 'running' | 'stopping' | 'error';

/** DockerContainerManager 构造选项 */
export interface DockerContainerOptions {
  /** 容器名称，如 napcat-<accountId> */
  containerName: string;
  /** Docker 镜像，默认 ghcr.io/napneko/napcat:latest */
  image?: string;
  /** 镜像版本标签（可选，覆盖 image 中的 tag） */
  version?: string;
  /** QQ 号（可选，传入后快速登录，无需扫码） */
  account?: string;
  /** 宿主机 OneBot 端口映射（容器内 3001） */
  oneBotPort: number;
  /** 宿主机 WebUI 端口映射（容器内 6099） */
  webUiPort: number;
  /** WebUI 鉴权 Token（自动生成） */
  webUiToken?: string;
  /** OneBot WebSocket 鉴权 Token */
  accessToken?: string;
  /** CPU 限制，如 "1.5"（可选） */
  cpuLimit?: string;
  /** 内存限制，如 "512M"（可选） */
  memoryLimit?: string;
  /** Docker 重启策略，默认 "unless-stopped" */
  restartPolicy?: string;
  /** 数据持久化目录（挂载到容器 /app/.config/QQ） */
  dataDir?: string;
  /** 日志回调 */
  onLog?: (line: string) => void;
  /** 状态变更回调 */
  onStatusChange?: (status: ContainerStatus) => void;
}

/** QR 码结果 */
export interface QRCodeResult {
  url: string;
  expiresAt: number;
}

/** 登录状态结果 */
export interface LoginStatusResult {
  isLogin: boolean;
  isOffline: boolean;
  qrcodeUrl?: string;
  loginError?: string;
}

/** QQ 登录信息 */
export interface QQLoginInfo {
  uin: string;
  nickname: string;
  avatarUrl?: string;
  online?: boolean;
}

/** WebUI 通用响应 */
interface WebUiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

// ════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════

const DEFAULT_IMAGE = 'ghcr.io/napneko/napcat:latest';
const CONTAINER_ONE_BOT_PORT = 3001;
const CONTAINER_WEB_UI_PORT = 6099;
const QR_CODE_TTL_MS = 120000;
const WEB_UI_READY_TIMEOUT_MS = 120000;
const WEB_UI_READY_POLL_INTERVAL = 2000;

// ════════════════════════════════════════════════════════════
// DockerContainerManager
// ════════════════════════════════════════════════════════════

export class DockerContainerManager {
  private options: Required<DockerContainerOptions>;
  private status: ContainerStatus = 'idle';
  private docker: Docker;
  private container: Container | null = null;
  private logs: string[] = [];
  private credential: string | null = null;
  private logStream: NodeJS.ReadableStream | null = null;

  constructor(options: DockerContainerOptions) {
    this.options = {
      image: DEFAULT_IMAGE,
      version: '',
      account: '',
      webUiToken: this.generateSecureToken(),
      accessToken: '',
      cpuLimit: '',
      memoryLimit: '',
      restartPolicy: 'unless-stopped',
      dataDir: '',
      onLog: () => {},
      onStatusChange: () => {},
      ...options,
    };

    this.docker = new Docker();
  }

  // ════════════════════════════════════════════════════════════
  // 1. 公共状态 API
  // ════════════════════════════════════════════════════════════

  getStatus(): ContainerStatus {
    return this.status;
  }

  getLogs(): readonly string[] {
    return this.logs;
  }

  getOneBotPort(): number {
    return this.options.oneBotPort;
  }

  getWebUiPort(): number {
    return this.options.webUiPort;
  }

  getContainerName(): string {
    return this.options.containerName;
  }

  // ════════════════════════════════════════════════════════════
  // 2. Docker 环境检测
  // ════════════════════════════════════════════════════════════

  /**
   * 检测 Docker 是否可用
   */
  static async isDockerAvailable(): Promise<boolean> {
    try {
      const docker = new Docker();
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 Docker 版本信息，附带更友好的错误提示
   *
   * 返回结果：
   *   { version: '24.0.7' }  — Docker 可用
   *   { error: '...', isDockerInstalled: false }  — Docker 未安装
   *   { error: '...', isDockerInstalled: true }   — Docker 已安装但未运行
   */
  static async getDockerInfo(): Promise<{ version?: string; error?: string; isDockerInstalled?: boolean }> {
    try {
      const docker = new Docker();
      const info = await docker.version();
      return { version: info.Version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();

      // 判断 Docker 是否已安装（但守护进程未运行）
      // 1. 连接被拒绝 → Docker 未运行（端口或 socket 未监听）
      // 2. 找不到 Docker 可执行文件 → 未安装
      if (lower.includes('econnrefused') || lower.includes('connect') && lower.includes('refused')) {
        return {
          error: 'Docker Desktop 未运行。请启动 Docker Desktop 后重试。',
          isDockerInstalled: true,
        };
      }

      // 尝试通过检查 Docker CLI 来区分"未安装"和"未运行"
      // 在 Windows 上，Docker Desktop 安装后 docker.exe 在 PATH 中
      try {
        const { execSync } = require('child_process');
        execSync('docker info', { stdio: 'pipe', timeout: 5000 });
        // docker info 成功但 dockerode 连不上 → 可能是 socket 路径问题
        return {
          error: `Docker 守护进程连接失败: ${message}。请检查 Docker Desktop 是否正在运行。`,
          isDockerInstalled: true,
        };
      } catch {
        // docker 命令也找不到 → 未安装
        return {
          error: '未检测到 Docker。请先安装 Docker Desktop：https://www.docker.com/products/docker-desktop/',
          isDockerInstalled: false,
        };
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 3. 容器生命周期
  // ════════════════════════════════════════════════════════════

  /**
   * 拉取镜像（如果本地不存在）
   */
  async pull(): Promise<void> {
    const image = this.resolveImage();
    this.log(`[Docker] 检查镜像: ${image}`);

    // 检查本地是否已有镜像
    const images = await this.docker.listImages();
    const hasImage = images.some(img =>
      (img.RepoTags ?? []).includes(image),
    );
    if (hasImage) {
      this.log(`[Docker] 镜像 ${image} 已存在，跳过拉取`);
      return;
    }

    this.setStatus('pulling');
    this.log(`[Docker] 拉取镜像: ${image}...`);

    return new Promise<void>((resolve, reject) => {
      const stream = this.docker.pull(image, {}, (err: Error | null, _stream: NodeJS.ReadableStream | undefined) => {
        if (err) {
          reject(new Error(`拉取镜像失败: ${err.message}`));
          return;
        }
        if (!_stream) {
          reject(new Error('拉取镜像返回空流'));
          return;
        }

        // 进度解析
        const onProgress = (event: { status?: string; progress?: string; id?: string }) => {
          if (event.status && event.id) {
            this.log(`[Docker] 拉取 ${event.id}: ${event.status} ${event.progress ?? ''}`);
          }
        };

        this.docker.modem.followProgress(
          _stream,
          (pullErr: Error | null) => {
            if (pullErr) {
              reject(new Error(`镜像拉取失败: ${pullErr.message}`));
            } else {
              this.log(`[Docker] 镜像 ${image} 拉取完成`);
              resolve();
            }
          },
          onProgress,
        );
      });
    });
  }

  /**
   * 启动容器
   */
  async start(): Promise<void> {
    if (this.status === 'running') return;

    this.setStatus('starting');
    this.credential = null;

    try {
      // 1. 拉取镜像
      await this.pull();

      // 2. 检查是否有同名容器（已存在）
      const existingContainer = await this.findExistingContainer();
      if (existingContainer) {
        this.log(`[Docker] 发现已有容器 ${this.options.containerName}，检查状态...`);

        const info = await existingContainer.inspect();
        if (info.State.Running) {
          // 容器已在运行，直接使用
          this.container = existingContainer;
          this.log(`[Docker] 容器 ${this.options.containerName} 已在运行`);
          await this.attachLogStream();
          await this.waitForWebUiReady();
          this.setStatus('running');
          return;
        }

        // 容器存在但未运行，删除后重建
        this.log(`[Docker] 容器 ${this.options.containerName} 未运行，删除重建`);
        await existingContainer.remove({ force: true });
      }

      // 3. 创建并启动容器
      const image = this.resolveImage();
      const containerName = this.options.containerName;
      const dataDir = this.getDataDir();

      // 确保数据目录存在
      if (dataDir) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const createOptions: Docker.ContainerCreateOptions = {
        Image: image,
        name: containerName,
        HostConfig: {
          PortBindings: {
            [`${CONTAINER_ONE_BOT_PORT}/tcp`]: [{ HostPort: String(this.options.oneBotPort) }],
            [`${CONTAINER_WEB_UI_PORT}/tcp`]: [{ HostPort: String(this.options.webUiPort) }],
          },
          RestartPolicy: {
            Name: this.options.restartPolicy as any,
          },
          Binds: dataDir ? [`${dataDir}:/app/.config/QQ`] : undefined,
          AutoRemove: false,
        },
        Env: this.buildEnv(),
        ExposedPorts: {
          [`${CONTAINER_ONE_BOT_PORT}/tcp`]: {},
          [`${CONTAINER_WEB_UI_PORT}/tcp`]: {},
        },
        AttachStdout: false,
        AttachStderr: false,
      };

      // 添加资源限制（如果配置了）
      if (this.options.cpuLimit) {
        createOptions.HostConfig!.NanoCpus = this.parseCpuLimit(this.options.cpuLimit);
      }
      if (this.options.memoryLimit) {
        createOptions.HostConfig!.Memory = this.parseMemoryLimit(this.options.memoryLimit);
      }

      this.container = await this.docker.createContainer(createOptions);
      this.log(`[Docker] 容器 ${containerName} 已创建`);

      await this.container.start();
      this.log(`[Docker] 容器 ${containerName} 已启动`);

      // 4. 附加日志流
      await this.attachLogStream();

      // 5. 等待 WebUI 就绪
      await this.waitForWebUiReady();

      this.setStatus('running');
      this.log(`[Docker] NapCat 容器运行中 (OneBot:${this.options.oneBotPort}, WebUI:${this.options.webUiPort})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[Docker] 容器启动失败: ${msg}`);
      this.setStatus('error');
      throw new Error(`NapCat Docker 容器启动失败: ${msg}`);
    }
  }

  /**
   * 停止容器
   */
  async stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'stopping') return;

    this.setStatus('stopping');
    this.log(`[Docker] 停止容器 ${this.options.containerName}...`);

    try {
      // 停止日志流
      this.detachLogStream();

      // 停止容器
      if (this.container) {
        try {
          await this.container.stop({ t: 10 }); // 10s 超时
        } catch {
          // 容器可能已停止，忽略错误
        }
        this.log(`[Docker] 容器 ${this.options.containerName} 已停止`);
      }
    } catch (err) {
      this.log(`[Docker] 停止容器失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.container = null;
      this.credential = null;
      this.setStatus('idle');
    }
  }

  /**
   * 重启容器
   */
  async restart(): Promise<void> {
    this.log(`[Docker] 重启容器 ${this.options.containerName}...`);
    if (this.container) {
      await this.container.restart();
      this.credential = null;
      await this.waitForWebUiReady();
      this.setStatus('running');
      this.log(`[Docker] 容器 ${this.options.containerName} 已重启`);
    } else {
      await this.start();
    }
  }

  /**
   * 删除容器
   */
  async remove(): Promise<void> {
    try {
      await this.stop();
      const existing = await this.findExistingContainer();
      if (existing) {
        await existing.remove({ force: true });
        this.log(`[Docker] 容器 ${this.options.containerName} 已删除`);
      }
    } catch (err) {
      this.log(`[Docker] 删除容器失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 检查容器是否正在运行
   */
  async isRunning(): Promise<boolean> {
    try {
      if (!this.container) return false;
      const info = await this.container.inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  /**
   * 获取容器 ID
   */
  async getContainerId(): Promise<string | null> {
    try {
      if (!this.container) return null;
      const info = await this.container.inspect();
      return info.Id;
    } catch {
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 4. QR 扫码登录（通过 WebUI API）
  // ════════════════════════════════════════════════════════════

  /**
   * 获取登录二维码
   */
  async getQRCode(): Promise<QRCodeResult> {
    const res = await this.webUiPost<WebUiResponse<{ qrcode: string }>>(
      '/api/QQLogin/GetQQLoginQrcode',
      {},
    );

    if (res.code !== 0 || !res.data?.qrcode) {
      throw new Error(res.message || '获取二维码失败');
    }

    return {
      url: res.data.qrcode,
      expiresAt: Date.now() + QR_CODE_TTL_MS,
    };
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(): Promise<LoginStatusResult> {
    const res = await this.webUiPost<
      WebUiResponse<{ isLogin: boolean; isOffline: boolean; qrcodeurl?: string; loginError?: string }>
    >('/api/QQLogin/CheckLoginStatus', {});

    if (res.code !== 0) {
      throw new Error(res.message || '检查登录状态失败');
    }

    return {
      isLogin: !!res.data?.isLogin,
      isOffline: !!res.data?.isOffline,
      qrcodeUrl: res.data?.qrcodeurl,
      loginError: res.data?.loginError,
    };
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo(): Promise<QQLoginInfo | null> {
    const res = await this.webUiPost<
      WebUiResponse<{
        uin?: string;
        nickname?: string;
        avatarUrl?: string;
        online?: boolean;
      }>
    >('/api/QQLogin/GetQQLoginInfo', {});

    if (res.code !== 0 || !res.data?.uin) {
      return null;
    }

    return {
      uin: String(res.data.uin),
      nickname: res.data.nickname ?? '',
      avatarUrl: res.data.avatarUrl,
      online: res.data.online,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 5. 内部实现
  // ════════════════════════════════════════════════════════════

  private setStatus(status: ContainerStatus): void {
    if (this.status === status) return;
    this.status = status;
    try {
      this.options.onStatusChange(status);
    } catch (err) {
      console.error('[DockerContainerManager] 状态回调异常:', err);
    }
  }

  private log(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 500) {
      this.logs.shift();
    }
    try {
      this.options.onLog(line);
    } catch (err) {
      console.error('[DockerContainerManager] 日志回调异常:', err);
    }
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * 解析完整镜像名（含版本标签）
   */
  private resolveImage(): string {
    const base = this.options.image;
    if (this.options.version) {
      const [repo] = base.split(':');
      return `${repo}:${this.options.version}`;
    }
    return base;
  }

  /**
   * 构建容器环境变量
   */
  private buildEnv(): string[] {
    const env: string[] = [];

    if (this.options.account) {
      env.push(`ACCOUNT=${this.options.account}`);
    }
    env.push(`WEBUI_TOKEN=${this.options.webUiToken}`);
    if (this.options.accessToken) {
      env.push(`ACCESS_TOKEN=${this.options.accessToken}`);
    }

    return env;
  }

  /**
   * 获取数据持久化目录
   * 默认：软件安装目录/Alice/qq-bot/napcat-data/<containerName>
   * 用户可通过 options.dataDir 自定义
   */
  private getDataDir(): string {
    if (this.options.dataDir) return this.options.dataDir;

    // 默认：软件安装目录/Alice/qq-bot/napcat-data/<containerName>
    const defaultDataDir = path.join(process.cwd(), 'Alice', 'qq-bot', 'napcat-data', this.options.containerName);
    try {
      fs.mkdirSync(defaultDataDir, { recursive: true });
    } catch {
      // 若默认目录创建失败，回退到 userData
      try {
        return path.join(app.getPath('userData'), 'napcat-data', this.options.containerName);
      } catch {
        return '';
      }
    }
    return defaultDataDir;
  }

  /**
   * 解析 CPU 限制字符串（如 "1.5" → 1.5 * 1e9）
   */
  private parseCpuLimit(cpu: string): number {
    const cores = parseFloat(cpu);
    return Math.round(cores * 1e9);
  }

  /**
   * 解析内存限制字符串（如 "512M" → 512 * 1024 * 1024）
   */
  private parseMemoryLimit(memory: string): number {
    const match = memory.match(/^(\d+)(K|M|G)?$/);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2] || 'M';

    switch (unit) {
      case 'K': return value * 1024;
      case 'M': return value * 1024 * 1024;
      case 'G': return value * 1024 * 1024 * 1024;
      default: return value * 1024 * 1024;
    }
  }

  /**
   * 查找已存在的同名容器
   */
  private async findExistingContainer(): Promise<Container | null> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const found = containers.find(c =>
        (c.Names ?? []).includes(`/${this.options.containerName}`),
      );
      if (found) {
        return this.docker.getContainer(found.Id);
      }
    } catch {
      // 忽略查找错误
    }
    return null;
  }

  /**
   * 附加容器日志流
   */
  private async attachLogStream(): Promise<void> {
    this.detachLogStream();

    if (!this.container) return;

    try {
      const rawStream = await this.container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 50,
      });

      // dockerode 在运行时返回 NodeJS.ReadableStream，但类型定义为 ReadableStream
      const stream = rawStream as unknown as NodeJS.ReadableStream;
      this.logStream = stream;

      stream.on('data', (chunk: Buffer) => {
        // Docker 日志格式：8 字节头部 + 内容
        // 跳过头部，只取内容部分
        const lines = chunk.toString('utf-8').split(/\r?\n/);
        for (const line of lines) {
          const clean = line.replace(/^.{8}/, '').trim(); // 去掉 Docker 日志头部
          if (clean) {
            this.log(`[NapCat] ${clean}`);
          }
        }
      });

      stream.on('error', (err: Error) => {
        this.log(`[Docker] 日志流错误: ${err.message}`);
      });

      stream.on('end', () => {
        this.logStream = null;
      });
    } catch (err) {
      this.log(`[Docker] 附加日志流失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 分离日志流
   */
  private detachLogStream(): void {
    if (this.logStream) {
      try {
        (this.logStream as any).destroy();
      } catch {
        // 忽略销毁错误
      }
      this.logStream = null;
    }
  }

  /**
   * 等待 WebUI 就绪
   */
  private async waitForWebUiReady(): Promise<void> {
    const startedAt = Date.now();
    const port = this.options.webUiPort;

    this.log(`[Docker] 等待 WebUI 就绪 (端口: ${port})...`);

    while (Date.now() - startedAt < WEB_UI_READY_TIMEOUT_MS) {
      try {
        await this.webUiGet('/api/auth/check', 3000);
        this.log(`[Docker] WebUI 已就绪，端口: ${port}`);
        return;
      } catch {
        await this.delay(WEB_UI_READY_POLL_INTERVAL);
      }
    }

    // 尝试获取容器日志帮助定位问题
    const containerLogs = await this.getContainerRecentLogs();
    throw new Error(
      `等待 WebUI 就绪超时 (${WEB_UI_READY_TIMEOUT_MS / 1000}s)。` +
      `容器最近日志:\n${containerLogs.join('\n').slice(0, 500)}`,
    );
  }

  /**
   * 获取容器最近日志（用于错误诊断）
   */
  private async getContainerRecentLogs(): Promise<string[]> {
    if (!this.container) return [];
    try {
      const buf = await this.container.logs({
        stdout: true,
        stderr: true,
        tail: 20,
      });
      return buf
        .toString('utf-8')
        .split(/\r?\n/)
        .map(l => l.replace(/^.{8}/, '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════
  // 6. WebUI HTTP 通信
  // ════════════════════════════════════════════════════════════

  /**
   * 调用 WebUI API（GET）
   */
  private async webUiGet<T>(endpoint: string, timeoutMs = 10000): Promise<T> {
    const targetPort = this.options.webUiPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {};
      const response = await fetch(`http://127.0.0.1:${targetPort}${endpoint}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`WebUI 返回非 JSON: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 调用 WebUI API（POST）
   * 注意：Docker 容器内 NapCat 的 WebUI 不需要额外的 SHA256 认证，
   * 通过 WEBUI_TOKEN 环境变量即可自动配置。
   */
  private async webUiPost<T>(endpoint: string, body: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
    const targetPort = this.options.webUiPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const response = await fetch(`http://127.0.0.1:${targetPort}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`WebUI 返回非 JSON: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建 DockerContainerManager 的便捷工厂
 */
export function createDockerContainerManager(options: DockerContainerOptions): DockerContainerManager {
  return new DockerContainerManager(options);
}