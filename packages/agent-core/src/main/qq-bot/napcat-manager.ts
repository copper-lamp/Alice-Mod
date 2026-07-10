/**
 * NapCatManager — NapCat 托管进程管理器
 *
 * 负责 NapCat 子进程的下载、配置、启动、停止、健康监控和崩溃恢复。
 * 通过 NapCat 内置 WebUI API 获取真实二维码和登录状态。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';

/** NapCat 运行状态 */
export type NapCatStatus = 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';

/** NapCatManager 构造选项 */
export interface NapCatManagerOptions {
  /** NapCat 安装根目录（默认：软件安装目录/napcat） */
  installDir: string;
  /** 用户数据目录（用于存放账号等运行时数据） */
  userDataPath: string;
  /** 机器人 QQ 号（可选，用于快速登录） */
  account?: string;
  /** NapCat 可执行文件路径或目录（可选，覆盖自动查找） */
  executablePath?: string;
  /** 目标版本（可选，默认 latest） */
  version?: string;
  /** OneBot WebSocket 端口（默认 3001） */
  oneBotPort?: number;
  /** WebUI 端口（默认 6099） */
  webUiPort?: number;
  /** WebUI 鉴权 token（默认随机生成） */
  webUiToken?: string;
  /** OneBot WebSocket 鉴权 token（默认空） */
  accessToken?: string;
  /** 日志回调 */
  onLog?: (line: string) => void;
  /** 状态变更回调 */
  onStatusChange?: (status: NapCatStatus) => void;
}

/** 二维码结果 */
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

/** WebUI 认证凭证 */
interface WebUiCredential {
  Data: {
    CreatedTime: number;
    HashEncoded: string;
  };
  Hmac: string;
}

const DEFAULT_ONE_BOT_PORT = 3001;
const DEFAULT_WEB_UI_PORT = 6099;
const QR_CODE_TTL_MS = 120000;
const WEB_UI_READY_TIMEOUT_MS = 120000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY_MS = 5000;

export class NapCatManager {
  private options: Required<NapCatManagerOptions>;
  private status: NapCatStatus = 'idle';
  private process: ChildProcess | null = null;
  private logs: string[] = [];
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private credential: string | null = null;
  private webUiActualPort = DEFAULT_WEB_UI_PORT;

  constructor(options: NapCatManagerOptions) {
    this.options = {
      account: '',
      executablePath: '',
      version: 'latest',
      oneBotPort: DEFAULT_ONE_BOT_PORT,
      webUiPort: DEFAULT_WEB_UI_PORT,
      webUiToken: this.generateSecureToken(),
      accessToken: '',
      onLog: () => {},
      onStatusChange: () => {},
      ...options,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 1. 公共状态 API
  // ════════════════════════════════════════════════════════════

  getStatus(): NapCatStatus {
    return this.status;
  }

  getLogs(): readonly string[] {
    return this.logs;
  }

  getWebUiPort(): number {
    return this.webUiActualPort;
  }

  /** 获取 NapCat 安装根目录 */
  getInstallDir(): string {
    return this.options.installDir || path.join(this.options.userDataPath, 'napcat');
  }

  /** 获取 NapCat 工作目录 */
  getNapCatDir(): string {
    return this.getInstallDir();
  }

  /** 获取 NapCat 配置文件目录 */
  getConfigDir(): string {
    return path.join(this.getNapCatDir(), 'config');
  }

  // ════════════════════════════════════════════════════════════
  // 2. 生命周期管理
  // ════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return;

    this.setStatus('starting');
    this.log('[NapCatManager] 启动 NapCat...');

    try {
      await this.ensureExecutable();
      this.writeOneBotConfig();
      this.writeWebUiConfig();
      await this.spawnProcess();
      await this.waitForWebUiReady();
      await this.authenticateWebUi();
      this.restartAttempts = 0;
      this.setStatus('running');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[NapCatManager] 启动失败: ${msg}`);
      this.setStatus('error');
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'stopping') return;

    this.setStatus('stopping');
    this.log('[NapCatManager] 停止 NapCat...');

    this.cancelRestart();

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await this.waitForExit(5000);
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }

    this.process = null;
    this.credential = null;
    this.setStatus('idle');
  }

  async restart(): Promise<void> {
    this.log('[NapCatManager] 重启 NapCat...');
    await this.stop();
    await this.start();
  }

  // ════════════════════════════════════════════════════════════
  // 3. 二维码与登录状态
  // ════════════════════════════════════════════════════════════

  async getQRCode(): Promise<QRCodeResult> {
    await this.ensureAuthenticated();

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

  async checkLoginStatus(): Promise<LoginStatusResult> {
    await this.ensureAuthenticated();

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

  async getLoginInfo(): Promise<QQLoginInfo | null> {
    await this.ensureAuthenticated();

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
  // 4. 内部实现
  // ════════════════════════════════════════════════════════════

  private setStatus(status: NapCatStatus): void {
    if (this.status === status) return;
    this.status = status;
    try {
      this.options.onStatusChange(status);
    } catch (err) {
      console.error('[NapCatManager] 状态回调异常:', err);
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
      console.error('[NapCatManager] 日志回调异常:', err);
    }
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /** 确保 NapCat 可执行文件存在 */
  private async ensureExecutable(): Promise<void> {
    if (this.options.executablePath) {
      const execPath = this.resolveExecutablePath(this.options.executablePath);
      if (execPath && fs.existsSync(execPath)) {
        this.options.executablePath = execPath;
        return;
      }
    }

    const defaultPath = this.findDefaultExecutable();
    if (defaultPath && fs.existsSync(defaultPath)) {
      this.options.executablePath = defaultPath;
      return;
    }

    await this.downloadRelease();
  }

  /** 解析用户配置的路径（支持目录或文件） */
  private resolveExecutablePath(input: string): string | null {
    if (fs.existsSync(input)) {
      if (fs.statSync(input).isFile()) return input;
      return this.findExecutableInDir(input);
    }
    return null;
  }

  /** 在 NapCat 目录中查找可执行文件 */
  private findExecutableInDir(dir: string): string | null {
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      candidates.push(
        path.join(dir, 'napcat.exe'),
        path.join(dir, 'NapCatWinBootMain.exe'),
        path.join(dir, 'launcher.bat'),
        path.join(dir, 'launcher-win10.bat'),
      );
    } else {
      candidates.push(path.join(dir, 'napcat'), path.join(dir, 'napcat.sh'));
    }
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** 查找默认路径下的可执行文件 */
  private findDefaultExecutable(): string | null {
    return this.findExecutableInDir(this.getNapCatDir());
  }

  /** 从 GitHub Releases 下载 NapCat（含国内镜像容错） */
  private async downloadRelease(): Promise<void> {
    this.setStatus('downloading');

    const napcatDir = this.getNapCatDir();
    fs.mkdirSync(napcatDir, { recursive: true });

    const version = this.options.version;
    const tag = version === 'latest' ? 'latest' : version;
    const assetName = this.resolveAssetName();
    const zipPath = path.join(napcatDir, assetName);

    // 下载地址列表：官方 GitHub + 国内镜像，依次尝试
    const urls: string[] = [
      `https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
      `https://ghproxy.net/https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
      `https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
    ];

    let lastError: string | null = null;
    for (const url of urls) {
      this.log(`[NapCatManager] 尝试下载: ${url}`);
      try {
        await this.downloadFile(url, zipPath);
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.log(`[NapCatManager] 下载失败: ${lastError}`);
      }
    }

    if (lastError) {
      this.setStatus('error');
      throw new Error(
        `NapCat 自动下载失败（网络环境受限）。请手动下载后通过安装向导配置：\n` +
        `1. 打开浏览器访问 https://github.com/NapNeko/NapCatQQ/releases\n` +
        `2. 下载 ${assetName}\n` +
        `3. 解压到任意非系统盘目录\n` +
        `4. 在 McAgent 的 NapCat 安装向导中配置该目录`,
      );
    }

    try {
      await this.extractZip(zipPath, napcatDir);
      fs.unlinkSync(zipPath);
    } catch (err) {
      this.setStatus('error');
      throw new Error(`解压 NapCat 失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    const execPath = this.findDefaultExecutable();
    if (!execPath) {
      this.setStatus('error');
      throw new Error('解压后未找到 NapCat 可执行文件，请手动配置 executablePath');
    }
    this.options.executablePath = execPath;
  }

  /** 根据平台选择 release asset */
  private resolveAssetName(): string {
    if (process.platform === 'win32') {
      return 'NapCat.Shell.Windows.OneKey.zip';
    }
    return 'NapCat.Shell.zip';
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    if (process.platform === 'win32') {
      // Windows: 使用 PowerShell Expand-Archive
      await this.runCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ]);
    } else {
      // Linux/macOS: 使用 unzip
      await this.runCommand('unzip', ['-o', zipPath, '-d', destDir]);
    }
  }

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'pipe' });
      let stderr = '';
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`命令退出码 ${code}: ${stderr}`));
      });
    });
  }

  /** 生成 OneBot v11 配置文件 */
  private writeOneBotConfig(): void {
    const configDir = this.getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });

    const config = {
      network: {
        httpServers: [],
        httpClients: [],
        websocketServers: [
          {
            name: 'McAgentWSServer',
            enable: true,
            host: '127.0.0.1',
            port: this.options.oneBotPort,
            messagePostFormat: 'array',
            reportSelfMessage: false,
            token: this.options.accessToken,
            enableForcePushEvent: true,
            debug: false,
            heartInterval: 30000,
          },
        ],
        websocketClients: [],
      },
      musicSignUrl: '',
      enableLocalFile2Url: false,
      parseMultMsg: false,
    };

    fs.writeFileSync(
      path.join(configDir, 'onebot11.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  }

  /** 生成 WebUI 配置文件 */
  private writeWebUiConfig(): void {
    const configDir = this.getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });

    const config = {
      host: '127.0.0.1',
      port: this.options.webUiPort,
      token: this.options.webUiToken,
      loginRate: 3,
    };

    fs.writeFileSync(
      path.join(configDir, 'webui.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  }

  /** 启动 NapCat 子进程 */
  private async spawnProcess(): Promise<void> {
    const execPath = this.options.executablePath;
    if (!execPath || !fs.existsSync(execPath)) {
      throw new Error('NapCat 可执行文件不存在');
    }

    const napcatDir = this.getNapCatDir();
    const args: string[] = [];
    if (this.options.account) {
      args.push('-q', this.options.account);
    }

    this.log(`[NapCatManager] spawn: ${execPath} ${args.join(' ')}`);

    const isBatchFile = execPath.toLowerCase().endsWith('.bat');
    const proc = isBatchFile
      ? spawn('cmd.exe', ['/c', execPath, ...args], {
          cwd: napcatDir,
          env: {
            ...process.env,
            NAPCAT_WEBUI_SECRET_KEY: this.options.webUiToken,
            NAPCAT_QUICK_ACCOUNT: this.options.account || '',
          },
        })
      : spawn(execPath, args, {
          cwd: napcatDir,
          env: {
            ...process.env,
            NAPCAT_WEBUI_SECRET_KEY: this.options.webUiToken,
            NAPCAT_QUICK_ACCOUNT: this.options.account || '',
          },
        });

    this.process = proc;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) this.log(`[NapCat] ${line}`);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) this.log(`[NapCat/stderr] ${line}`);
      }
    });

    proc.on('error', (err) => {
      this.log(`[NapCatManager] 子进程错误: ${err.message}`);
      this.setStatus('error');
    });

    proc.on('exit', (code, signal) => {
      this.log(`[NapCatManager] 子进程退出: code=${code}, signal=${signal}`);
      this.process = null;
      if (this.status !== 'stopping') {
        this.handleCrash();
      }
    });
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.process?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** 等待 WebUI 就绪 */
  private async waitForWebUiReady(): Promise<void> {
    const startedAt = Date.now();
    const port = await this.detectWebUiPort();
    this.webUiActualPort = port;

    while (Date.now() - startedAt < WEB_UI_READY_TIMEOUT_MS) {
      try {
        await this.webUiGet('/api/auth/check', 3000);
        this.log(`[NapCatManager] WebUI 已就绪，端口: ${port}`);
        return;
      } catch {
        await this.delay(1000);
      }
    }

    throw new Error('等待 WebUI 就绪超时');
  }

  /** 探测 WebUI 实际端口 */
  private async detectWebUiPort(): Promise<number> {
    // 优先读取启动日志中的端口
    const logText = this.logs.join('\n');
    const match = logText.match(/WebUi User Panel Url: http:\/\/[^:]+:(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }

    // 回退到配置端口，尝试附近几个端口
    const preferred = this.options.webUiPort;
    for (let port = preferred; port < preferred + 10; port++) {
      try {
        await this.webUiGet('/api/auth/check', 1000, port);
        return port;
      } catch {
        // continue
      }
    }

    return preferred;
  }

  /** WebUI 登录认证 */
  private async authenticateWebUi(): Promise<void> {
    const hash = crypto
      .createHash('sha256')
      .update(this.options.webUiToken + '.napcat')
      .digest('hex');

    const res = await this.webUiPost<
      WebUiResponse<{ Credential?: string; require2FA?: boolean }>
    >('/api/auth/login', { hash }, 10000);

    if (res.code !== 0 || !res.data?.Credential) {
      throw new Error(res.message || 'WebUI 登录失败');
    }

    if (res.data.require2FA) {
      throw new Error('WebUI 启用了 2FA，请通过 NapCat WebUI 手动完成登录');
    }

    this.credential = res.data.Credential;
    this.log('[NapCatManager] WebUI 认证成功');
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.credential) return;
    await this.authenticateWebUi();
  }

  /** 调用 WebUI API（GET） */
  private async webUiGet<T>(
    endpoint: string,
    timeoutMs = 10000,
    port?: number,
  ): Promise<T> {
    const targetPort = port ?? this.webUiActualPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (this.credential) {
        headers['Authorization'] = `Bearer ${this.credential}`;
      }

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

  /** 调用 WebUI API（POST） */
  private async webUiPost<T>(
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs = 10000,
    port?: number,
  ): Promise<T> {
    const targetPort = port ?? this.webUiActualPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.credential) {
        headers['Authorization'] = `Bearer ${this.credential}`;
      }

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

  /** 处理子进程崩溃 */
  private handleCrash(): void {
    if (this.status === 'stopping' || this.status === 'idle') return;

    this.restartAttempts++;
    if (this.restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.log('[NapCatManager] 超过最大重启次数，停止自动恢复');
      this.setStatus('error');
      return;
    }

    this.log(`[NapCatManager] ${RESTART_DELAY_MS / 1000} 秒后尝试第 ${this.restartAttempts} 次重启...`);
    this.setStatus('error');

    this.cancelRestart();
    this.restartTimer = setTimeout(() => {
      this.start().catch((err) => {
        this.log(`[NapCatManager] 自动重启失败: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, RESTART_DELAY_MS);
  }

  private cancelRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** 创建 NapCatManager 的便捷工厂 */
export function createNapCatManager(options: NapCatManagerOptions): NapCatManager {
  return new NapCatManager(options);
}
