/**
 * NapCatManager — NapCat 托管进程管理器
 *
 * 负责 NapCat 子进程的下载、配置、启动、停止、健康监控和崩溃恢复。
 * 通过 NapCat 内置 WebUI API 获取真实二维码和登录状态。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';
import { spawn, exec, ChildProcess } from 'child_process';

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
  /** 工作目录（可选，覆盖 installDir 作为 spawn cwd；用于每个账号独立 NapCat 目录） */
  workingDir?: string;
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
  /** 下载进度回调 */
  onProgress?: (progress: DownloadProgress) => void;
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

/** 下载进度信息 */
export interface DownloadProgress {
  /** 进度百分比 0-100 */
  percent: number;
  /** 当前阶段：testing_mirrors | downloading | extracting | done */
  stage: string;
  /** 当前阶段描述 */
  message: string;
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
  /** 标记是否由 start() 的 catch 块/stop() 主动杀进程，防止 exit handler 误触 handleCrash() */
  private _intentionalShutdown = false;

  constructor(options: NapCatManagerOptions) {
    this.options = {
      account: '',
      executablePath: '',
      workingDir: '',
      version: 'latest',
      oneBotPort: DEFAULT_ONE_BOT_PORT,
      webUiPort: DEFAULT_WEB_UI_PORT,
      webUiToken: this.generateSecureToken(),
      accessToken: '',
      onLog: () => {},
      onStatusChange: () => {},
      onProgress: () => {},
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

  getOneBotPort(): number {
    return this.options.oneBotPort || DEFAULT_ONE_BOT_PORT;
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
    // 优先使用 executablePath 所在目录的 config/，因为 NapCat 实际读取的是 launcher.bat 目录下的 config/
    if (this.options.executablePath) {
      const execDir = path.dirname(this.options.executablePath);
      return path.join(execDir, 'config');
    }
    // 回退到 installDir 下的 config/
    return path.join(this.getNapCatDir(), 'config');
  }

  // ════════════════════════════════════════════════════════════
  // 2. 生命周期管理
  // ════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return;

    // 清除上次的认证凭证，强制重新登录
    this.credential = null;

    this.setStatus('starting');
    this.log(`[NapCatManager] 启动 NapCat... token=${this.options.webUiToken.substring(0, 8)}..., port=${this.options.webUiPort}, execPath=${this.options.executablePath}`);

    try {
      // 1. 确保安装目录存在（文档 §4.2 step 1）
      const napcatDir = this.getNapCatDir();
      fs.mkdirSync(napcatDir, { recursive: true });

      // 2. 清理残留进程：调用 KillQQ.bat 杀死所有 QQ.exe 进程，释放端口
      await this.runKillQQBat();
      this.process = null;
      await this.waitForPortFree(this.options.webUiPort, 3000);

      // 3. 确保可执行文件存在（文档 §4.2 step 2）
      await this.ensureExecutable();

      // 4. 读取现有配置文件，不写入端口与改写 token（文档 §4.2 step 3-4：只读取）
      this.readOneBotConfig();
      this.readWebUiConfig();

      // 5. 启动子进程（文档 §4.2 step 5）
      await this.spawnProcess();

      // 6. 等待 WebUI 就绪（文档 §4.2 step 6）
      await this.waitForWebUiReady();

      // 7. WebUI 认证获取 Credential（文档 §4.2 step 7）
      await this.authenticateWebUi();

      // 8. 状态变为 running（文档 §4.2 step 8）
      this.restartAttempts = 0;
      this.setStatus('running');
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const enhancedMsg = this.enhanceStartupError(rawMsg);
      this.log(`[NapCatManager] 启动失败: ${enhancedMsg}`);

      // 标记主动关闭，防止 exit handler 误触 handleCrash()
      this._intentionalShutdown = true;

      // 清理可能已经启动的子进程，防止残留
      await this.runKillQQBat();
      this.process = null;

      this.setStatus('error');
      throw new Error(enhancedMsg);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'stopping') return;

    this.setStatus('stopping');
    this.log('[NapCatManager] 停止 NapCat...');

    this.cancelRestart();

    // 1. 先优雅关闭托管进程
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await this.waitForExit(5000);
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }

    // 2. 调用 KillQQ.bat 杀死所有 QQ.exe 进程，释放端口
    await this.runKillQQBat();

    // 3. 等待 WebUI 端口释放，确保完全清理
    await this.waitForPortFree(this.webUiActualPort, 3000);

    this.process = null;
    this.credential = null;
    this.setStatus('idle');
    this.log('[NapCatManager] NapCat 已完全停止');
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
      // 如果找到的是 NapCatWinBootMain.exe（OneKey 包），且没有 QQ 号，则重下载 Shell 包
      const name = path.basename(defaultPath).toLowerCase();
      if (name === 'napcatwinbootmain.exe' || name === 'napcat.exe') {
        const alt = this.findAlternativeLauncher(this.getNapCatDir());
        if (!alt) {
          this.log('[NapCatManager] 检测到 OneKey 包，需重新下载 Shell 包...');
          await this.cleanupAndRedownload();
          return;
        }
        this.options.executablePath = alt;
        return;
      }
      this.options.executablePath = defaultPath;
      return;
    }

    await this.downloadRelease();
  }

  /** 清理旧安装并重新下载 Shell 包 */
  private async cleanupAndRedownload(): Promise<void> {
    const dir = this.getNapCatDir();
    try {
      // 删除旧 zip 文件（避免被误认为已下载）
      const oldZip = path.join(dir, 'NapCat.Shell.Windows.OneKey.zip');
      if (fs.existsSync(oldZip)) fs.unlinkSync(oldZip);
    } catch { /* ignore */ }
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
        // OneKey 包：优先使用 napcat.bat（不要求 QQ 号）
        'napcat.bat',
        // Shell 包：launcher.bat / launcher-win10.bat
        'launcher.bat',
        'launcher-win10.bat',
        // OneKey 包直接 exe（需要 QQ 号参数）
        'NapCatWinBootMain.exe',
        'napcat.exe',
      );
    } else {
      candidates.push('napcat', 'napcat.sh');
    }

    // 先搜根目录
    for (const name of candidates) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }

    // 再搜一级子目录（OneKey ZIP 解压后可能在子文件夹中）
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          for (const name of candidates) {
            const p = path.join(dir, entry.name, name);
            if (fs.existsSync(p)) return p;
          }
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  /** 查找默认路径下的可执行文件 */
  private findDefaultExecutable(): string | null {
    return this.findExecutableInDir(this.getNapCatDir());
  }

  /** 从 GitHub Releases 获取最新 release 的 tag */
  private async resolveLatestTag(): Promise<string> {
    // 优先使用 curl.exe（避开 Windows SSL 吊销检查）
    if (process.platform === 'win32') {
      try {
        const out = await new Promise<string>((resolve, reject) => {
            const proc = spawn('curl.exe', [
              '-s', '-L',
              '--ssl-no-revoke',
              '--connect-timeout', '10',
              '--max-time', '15',
            '-H', 'Accept: application/json',
            '-H', 'User-Agent: McAgent/1.0',
            'https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest',
          ], { stdio: ['pipe', 'pipe', 'pipe'] });
          let data = '';
          let err = '';
          proc.stdout?.on('data', (d: Buffer) => { data += d.toString(); });
          proc.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
          proc.on('error', reject);
          proc.on('close', (code) => {
            if (code === 0 && data) resolve(data);
            else reject(new Error(`curl exit ${code}: ${err.substring(0, 200)}`));
          });
        });
        const parsed = JSON.parse(out) as { tag_name: string };
        if (parsed.tag_name) {
          this.log(`[NapCatManager] 获取到最新版本: ${parsed.tag_name}`);
          return parsed.tag_name;
        }
      } catch (err) {
        this.log(`[NapCatManager] curl API 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 回退：使用 fetch
    try {
      const res = await fetch('https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'McAgent/1.0' },
      });
      if (res.ok) {
        const data = await res.json() as { tag_name: string };
        this.log(`[NapCatManager] 获取到最新版本: ${data.tag_name}`);
        return data.tag_name;
      }
    } catch { /* 继续 */ }

    // 全部失败，使用备用版本
    this.log('[NapCatManager] 无法获取最新版本号，使用备用版本 v4.18.9');
    return 'v4.18.9';
  }

  /** 发送下载进度 */
  private emitProgress(percent: number, stage: string, message: string): void {
    this.options.onProgress?.({ percent, stage, message });
  }

  /** 测速选择最快下载通道 */
  private async selectFastestUrl(urls: string[]): Promise<string[]> {
    this.emitProgress(0, 'testing_mirrors', '正在测试下载通道...');
    const results: { url: string; time: number }[] = [];

    await Promise.allSettled(
      urls.map(async (url) => {
        const start = Date.now();
        try {
          if (process.platform === 'win32') {
            await this.runCommand('curl.exe', [
              '-s', '-o', 'nul', '-w', '%{http_code}',
              '--ssl-no-revoke',
              '--connect-timeout', '5',
              '--max-time', '10',
              '-I', url,
            ]);
          } else {
            const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }
          results.push({ url, time: Date.now() - start });
          this.log(`[NapCatManager] 通道测速 ${url.substring(0, 60)}...: ${Date.now() - start}ms`);
        } catch {
          results.push({ url, time: Infinity });
          this.log(`[NapCatManager] 通道不可达 ${url.substring(0, 60)}...`);
        }
      }),
    );

    // 按速度排序，不可达的排在最后
    results.sort((a, b) => a.time - b.time);
    const sorted = results.map(r => r.url);
    this.log(`[NapCatManager] 通道优先级: ${sorted.map(u => u.substring(0, 40)).join(' > ')}`);
    return sorted;
  }

  /** 从 GitHub Releases 下载 NapCat（含国内镜像容错） */
  private async downloadRelease(): Promise<void> {
    this.setStatus('downloading');

    const napcatDir = this.getNapCatDir();
    fs.mkdirSync(napcatDir, { recursive: true });

    const version = this.options.version;
    const tag = version === 'latest' ? await this.resolveLatestTag() : version;
    const assetName = this.resolveAssetName();
    const zipPath = path.join(napcatDir, assetName);

    // 下载地址列表：官方 GitHub + 国内镜像
    const urls: string[] = [
      `https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
      `https://ghproxy.net/https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
      `https://gh.api.99988866.xyz/https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
      `https://gh.ddlc.top/https://github.com/NapNeko/NapCatQQ/releases/download/${tag}/${assetName}`,
    ];

    // Shell 包仅 ~1MB，直接按顺序尝试下载，省略独立测速阶段
    this.emitProgress(5, 'downloading', '开始下载 NapCat...');

    let lastError: string | null = null;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      this.log(`[NapCatManager] 尝试下载: ${url}`);
      try {
        const stageStart = 5 + (i / urls.length) * 80;
        const stageEnd = 5 + ((i + 1) / urls.length) * 80;
        this.emitProgress(Math.round(stageStart), 'downloading', `正在下载 (通道 ${i + 1}/${urls.length})...`);
        await this.downloadFile(url, zipPath, (progress) => {
          const pct = Math.round(stageStart + (stageEnd - stageStart) * (progress.percent / 100));
          this.emitProgress(pct, 'downloading',
            `下载中 ${this.formatBytes(progress.loaded)} / ${progress.total ? this.formatBytes(progress.total) : '...'}`);
        });
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

    this.emitProgress(90, 'extracting', '正在解压 NapCat...');
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

    this.emitProgress(100, 'done', 'NapCat 安装完成');
  }

  /** 根据平台选择 release asset */
  private resolveAssetName(): string {
    if (process.platform === 'win32') {
      // NapCat.Shell.zip 是轻量级 Shell 包（~1MB），不内嵌 QQ，适合托管
      // NapCat.Shell.Windows.OneKey.zip 是自包含包（~200MB），内嵌 QQ，但需要 QQ 号才能启动
      return 'NapCat.Shell.zip';
    }
    return 'NapCat.Shell.zip';
  }

  private async downloadFile(url: string, dest: string, onProgress?: (p: { loaded: number; total: number | null; percent: number }) => void): Promise<void> {
    this.log(`[NapCatManager] downloadFile 开始: url=${url.substring(0, 80)}... dest=${dest}`);

    if (process.platform === 'win32') {
      // 优先使用 aria2c（多连接下载，大幅提升速度）
      const aria2cPath = await this.findTool('aria2c.exe');
      if (aria2cPath) {
        this.log(`[NapCatManager] 使用 aria2c 下载 (多连接)...`);
        try {
          await this.runCommand('aria2c.exe', [
            '-x', '8', '-s', '8', '-k', '1M',
            '--connect-timeout', '15',
            '--timeout', '30',
            '--max-tries', '5',
            '--retry-wait', '5',
            '--console-log-level', 'warn',
            '--summary-interval', '0',
            '-d', path.dirname(dest),
            '-o', path.basename(dest),
            url,
          ]);
          const stat = fs.statSync(dest);
          this.log(`[NapCatManager] aria2c 下载完成，文件大小: ${stat.size} bytes`);
          onProgress?.({ loaded: stat.size, total: stat.size, percent: 100 });
          if (stat.size > 1024) return;
          throw new Error(`下载文件过小: ${stat.size} bytes`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log(`[NapCatManager] aria2c 下载失败: ${msg}，降级到 curl`);
          try { fs.unlinkSync(dest); } catch { /* ignore */ }
        }
      }

      // 次选 curl.exe（Windows 自带，尊重系统代理）
      try {
        const curlPath = await this.findTool('curl.exe');
        this.log(`[NapCatManager] where curl.exe 结果: ${curlPath || '(未找到)'}`);

        if (curlPath) {
          this.log(`[NapCatManager] 使用 curl.exe 下载...`);
          await this.runCommand('curl.exe', [
            '-L',
            '-o', dest,
            '--connect-timeout', '15',
            '--max-time', '600',
            '--ssl-no-revoke',
            '--retry', '3',
            '--retry-delay', '5',
            url,
          ]);
          const stat = fs.statSync(dest);
          this.log(`[NapCatManager] curl.exe 下载完成，文件大小: ${stat.size} bytes`);
          onProgress?.({ loaded: stat.size, total: stat.size, percent: 100 });
          if (stat.size > 1024) return;
          throw new Error(`下载文件过小: ${stat.size} bytes`);
        } else {
          this.log(`[NapCatManager] curl.exe 不存在，使用 Node 多连接下载`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[NapCatManager] curl.exe 下载失败: ${msg}，使用 Node 多连接下载`);
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
      }
    } else {
      this.log(`[NapCatManager] 非 Windows 平台，使用 Node 多连接下载`);
    }

    // Node.js 内置多连接分块下载（无需外部工具）
    await this.downloadWithMultiFetch(url, dest, onProgress);
  }

  /** Node.js 内置多连接分块下载：用 HTTP Range 头并发下载不同片段 */
  private async downloadWithMultiFetch(url: string, dest: string, onProgress?: (p: { loaded: number; total: number | null; percent: number }) => void): Promise<void> {
    this.log(`[NapCatManager] Node 多连接下载开始...`);

    // 1. HEAD 请求获取文件大小
    let totalSize: number;
    try {
      const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
      const cl = headRes.headers.get('content-length');
      if (!cl) throw new Error('无 Content-Length');
      totalSize = parseInt(cl, 10);
      this.log(`[NapCatManager] 文件大小: ${this.formatBytes(totalSize)}`);
    } catch {
      this.log(`[NapCatManager] HEAD 请求失败，降级到单连接下载`);
      await this.downloadWithFetch(url, dest, onProgress);
      return;
    }

    // 2. 分成 4 块并行下载
    const NUM = 4;
    const chunkSize = Math.ceil(totalSize / NUM);
    const ranges: { start: number; end: number }[] = [];
    for (let i = 0; i < NUM; i++) {
      const start = i * chunkSize;
      const end = i === NUM - 1 ? totalSize - 1 : (i + 1) * chunkSize - 1;
      ranges.push({ start, end });
    }

    this.log(`[NapCatManager] 分 ${NUM} 块并行下载: ${ranges.map(r => `${this.formatBytes(r.start)}-${this.formatBytes(r.end)}`).join(', ')}`);

    const loadedPerChunk = new Array(NUM).fill(0);

    try {
      const buffers = await Promise.all(
        ranges.map((range, idx) =>
          this.downloadRange(url, range.start, range.end, idx, totalSize, loadedPerChunk, onProgress)
        )
      );

      // 3. 合并文件
      const fd = fs.openSync(dest, 'w');
      let totalWritten = 0;
      for (const buf of buffers) {
        fs.writeSync(fd, buf);
        totalWritten += buf.length;
      }
      fs.closeSync(fd);

      this.log(`[NapCatManager] Node 多连接下载完成: ${this.formatBytes(totalWritten)}`);
      onProgress?.({ loaded: totalWritten, total: totalWritten, percent: 100 });

      if (totalWritten < 1024) throw new Error(`下载文件过小: ${totalWritten} bytes`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[NapCatManager] Node 多连接下载失败: ${msg}，降级到单连接`);
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      await this.downloadWithFetch(url, dest, onProgress);
    }
  }

  /** 下载单个 Range 片段 */
  private async downloadRange(
    url: string, start: number, end: number, idx: number,
    totalSize: number, loadedPerChunk: number[],
    onProgress?: (p: { loaded: number; total: number | null; percent: number }) => void,
  ): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Range': `bytes=${start}-${end}`,
          'User-Agent': 'McAgent/1.0',
        },
      });
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status} (期望 206 Partial Content)`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const buf = Buffer.from(await res.arrayBuffer());
        return buf;
      }

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loadedPerChunk[idx] += value.length;
          // 汇总进度
          const totalLoaded = loadedPerChunk.reduce((a, b) => a + b, 0);
          const pct = Math.min(Math.round((totalLoaded / totalSize) * 100), 100);
          onProgress?.({ loaded: totalLoaded, total: totalSize, percent: pct });
        }
      }

      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 查找系统工具路径 */
  private async findTool(name: string): Promise<string | null> {
    try {
      const result = await new Promise<string>((resolve) => {
        const proc = spawn('where.exe', [name], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', (code: number) => resolve(code === 0 ? out.trim() : ''));
      });
      return result || null;
    } catch {
      return null;
    }
  }

  private async downloadWithFetch(url: string, dest: string, onProgress?: (p: { loaded: number; total: number | null; percent: number }) => void): Promise<void> {
    this.log(`[NapCatManager] fetch 开始下载: ${url.substring(0, 80)}...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      this.log(`[NapCatManager] fetch 超时 (600s)，终止请求`);
      controller.abort();
    }, 600_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'McAgent/1.0' },
      });
      this.log(`[NapCatManager] fetch 响应: HTTP ${response.status} ${response.statusText}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : null;
      let loaded = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        // 回退：直接读完整响应
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(dest, buffer);
        onProgress?.({ loaded: buffer.length, total: buffer.length, percent: 100 });
        this.log(`[NapCatManager] fetch 下载完成: ${buffer.length} bytes`);
        return;
      }

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          if (total) {
            const pct = Math.min(Math.round((loaded / total) * 100), 100);
            onProgress?.({ loaded, total, percent: pct });
          } else {
            onProgress?.({ loaded, total: null, percent: 0 });
          }
        }
      }

      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(dest, buffer);
      onProgress?.({ loaded: buffer.length, total: buffer.length, percent: 100 });
      this.log(`[NapCatManager] fetch 下载完成: ${buffer.length} bytes`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[NapCatManager] fetch 下载失败: ${msg}`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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

  /** 格式化字节数 */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** 查找无 QQ 号时可启动的替代 launcher（napcat.bat / launcher.bat） */
  private findAlternativeLauncher(dir: string): string | null {
    const altNames = ['napcat.bat', 'launcher.bat', 'launcher-win10.bat'];
    // 搜根目录
    for (const name of altNames) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    // 搜一级子目录
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          for (const name of altNames) {
            const p = path.join(dir, entry.name, name);
            if (fs.existsSync(p)) return p;
          }
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  /** 读取 OneBot 配置文件（仅读取，不写入端口与 token） */
  private readOneBotConfig(): void {
    const configPath = path.join(this.getConfigDir(), 'onebot11.json');
    if (!fs.existsSync(configPath)) {
      this.log(`[NapCatManager] 未找到 onebot11.json 配置，使用默认值`);
      return;
    }
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const wsServer = config.network?.websocketServers?.[0];
      if (wsServer?.port) {
        this.options.oneBotPort = wsServer.port;
        this.log(`[NapCatManager] 读取 OneBot 配置: port=${wsServer.port}`);
      }
      if (wsServer?.token !== undefined) {
        this.options.accessToken = wsServer.token;
      }
    } catch (err) {
      this.log(`[NapCatManager] 读取 onebot11.json 失败: ${err}`);
    }
  }

  /** 读取 WebUI 配置文件（仅读取，不写入端口与 token） */
  private readWebUiConfig(): void {
    const configPath = path.join(this.getConfigDir(), 'webui.json');
    if (!fs.existsSync(configPath)) {
      this.log(`[NapCatManager] 未找到 webui.json 配置，使用默认值`);
      return;
    }
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.port) {
        this.options.webUiPort = config.port;
        this.log(`[NapCatManager] 读取 WebUI 配置: port=${config.port}`);
      }
      if (config.token) {
        this.options.webUiToken = config.token;
        this.log(`[NapCatManager] 读取 WebUI 配置: token=${config.token.substring(0, 8)}...`);
      }
    } catch (err) {
      this.log(`[NapCatManager] 读取 webui.json 失败: ${err}`);
    }
  }

  /** 启动 NapCat 子进程 */
  private async spawnProcess(): Promise<void> {
    const execPath = this.options.executablePath;
    if (!execPath || !fs.existsSync(execPath)) {
      throw new Error('NapCat 可执行文件不存在');
    }

    const napcatDir = this.getNapCatDir();
    const execName = path.basename(execPath).toLowerCase();
    const isNapCatExe = execName === 'napcatwinbootmain.exe' || execName === 'napcat.exe';

    const args: string[] = [];
    if (this.options.account) {
      if (isNapCatExe) {
        // NapCatWinBootMain.exe / napcat.exe 将 QQ 号作为位置参数
        args.push(this.options.account.toString());
      } else {
        // launcher.bat / napcat.bat 使用 -q 参数
        args.push('-q', this.options.account.toString());
      }
    } else if (isNapCatExe) {
      // QR 登录模式：没有 QQ 号时不能启动 NapCatWinBootMain.exe
      // 改用 napcat.bat（由 OneKey 安装器在子目录中生成）
      const altPath = this.findAlternativeLauncher(napcatDir);
      if (altPath) {
        this.log(`[NapCatManager] 无 QQ 号，改用: ${altPath}`);
        this.options.executablePath = altPath;
        return this.spawnProcess();
      }
      throw new Error('NapCatWinBootMain.exe 需要 QQ 号作为参数。请先通过 napcat.bat 启动，或配置 account。');
    }

    this.log(`[NapCatManager] spawn: ${execPath} ${args.join(' ')}`);

    const cwd = this.options.workingDir || napcatDir;
    const execDir = path.dirname(execPath);
    const env = {
      ...process.env,
      NAPCAT_WEBUI_SECRET_KEY: this.options.webUiToken,
      NAPCAT_QUICK_ACCOUNT: this.options.account || '',
      // NAPCAT_WORKDIR 确保 NapCat 从正确的目录读取 config/ 配置
      // 因为 launcher.bat 的 runAs 提升权限后会丢失 spawn 的环境变量，
      // 所以必须通过配置文件路径来保证一致性，同时设置 WORKDIR 作为兜底
      NAPCAT_WORKDIR: execDir,
    };
    this.log(`[NapCatManager] spawn env: cwd=${cwd}, NAPCAT_WORKDIR=${execDir}, NAPCAT_QUICK_ACCOUNT=${env.NAPCAT_QUICK_ACCOUNT}`);
    // 显式使用 cmd.exe /c 包装 .bat 文件，避免 Node.js 直接 spawn .bat 时的 EINVAL 错误
    // windowsVerbatimArguments: true 确保路径中的空格和特殊字符被正确处理
    const proc = spawn(
      process.env.comspec || 'cmd.exe',
      ['/d', '/c', `"${execPath}"`, ...args],
      { cwd, env, windowsVerbatimArguments: true }
    );

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
      // 主动关闭（start() 失败/stop()）时，不触发错误重启
      if (this._intentionalShutdown) {
        this._intentionalShutdown = false;
        return;
      }
      if (this.status !== 'stopping' && this.status !== 'starting') {
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
    this.log(`[NapCatManager] WebUI 等待超时 (${WEB_UI_READY_TIMEOUT_MS / 1000}s)`);
    throw new Error('等待 WebUI 就绪超时');
  }

  /** 探测 WebUI 实际端口 */
  private async detectWebUiPort(): Promise<number> {
    // 优先读取启动日志中的端口
    const logText = this.logs.join('\n');
    const match = logText.match(/WebUi User Panel Url: http:\/\/[^:]+:(\d+)/);
    if (match) {
      this.log(`[NapCatManager] 从日志检测到 WebUI 端口: ${match[1]}`);
      return parseInt(match[1], 10);
    }

    // 回退到配置端口，尝试附近几个端口
    const preferred = this.options.webUiPort;
    this.log(`[NapCatManager] 尝试扫描端口: ${preferred}~${preferred + 9}`);
    for (let port = preferred; port < preferred + 10; port++) {
      try {
        await this.webUiGet('/api/auth/check', 1000, port);
        this.log(`[NapCatManager] 端口扫描成功: ${port}`);
        return port;
      } catch {
        // continue
      }
    }
    this.log(`[NapCatManager] 端口扫描未找到 WebUI，回退到配置端口: ${preferred}`);
    return preferred;
  }

  /** WebUI 登录认证 */
  private async authenticateWebUi(): Promise<void> {
    const hash = crypto
      .createHash('sha256')
      .update(this.options.webUiToken + '.napcat')
      .digest('hex');

    this.log(`[NapCatManager] 认证 WebUI: port=${this.webUiActualPort}, token=${this.options.webUiToken.substring(0, 8)}..., hash=${hash.substring(0, 12)}...`);

    const res = await this.webUiPost<
      WebUiResponse<{ Credential?: string; require2FA?: boolean }>
    >('/api/auth/login', { hash }, 10000);

    this.log(`[NapCatManager] WebUI 登录响应: code=${res.code}, message=${res.message}, hasCredential=${!!res.data?.Credential}, require2FA=${!!res.data?.require2FA}`);

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

  // ════════════════════════════════════════════════════════════
  // 7. 兜底策略与增强反馈
  // ════════════════════════════════════════════════════════════

  /**
   * 调用 KillQQ.bat 杀死所有 QQ.exe 进程，释放端口
   * 优先查找可执行文件所在目录的 KillQQ.bat，回退到项目 libs 目录
   */
  private async runKillQQBat(): Promise<void> {
    const candidates: string[] = [];

    // 优先：可执行文件所在目录
    if (this.options.executablePath) {
      candidates.push(path.join(path.dirname(this.options.executablePath), 'KillQQ.bat'));
    }
    // 其次：NapCat 安装目录
    candidates.push(path.join(this.getNapCatDir(), 'KillQQ.bat'));
    // 回退：项目 libs 目录
    candidates.push(path.join(process.cwd(), 'libs', 'KillQQ.bat'));

    let batPath: string | null = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        batPath = p;
        break;
      }
    }

    if (!batPath) {
      this.log('[NapCatManager] 未找到 KillQQ.bat，直接使用 taskkill');
      return new Promise((resolve) => {
        exec('taskkill /f /im QQ.exe 2>nul', () => resolve());
      });
    }

    this.log(`[NapCatManager] 调用 KillQQ.bat: ${batPath}`);
    return new Promise((resolve) => {
      exec(`"${batPath}"`, (err) => {
        if (err) {
          this.log(`[NapCatManager] KillQQ.bat 执行完成（可能无进程需杀）`);
        } else {
          this.log(`[NapCatManager] KillQQ.bat 执行成功`);
        }
        resolve();
      });
    });
  }

  /**
   * 等待指定端口释放
   * 轮询检测端口是否可被监听（free），直到超时
   */
  private waitForPortFree(port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (Date.now() - start >= timeoutMs) {
          this.log(`[NapCatManager] 等待端口 ${port} 释放超时，继续执行`);
          return resolve();
        }

        const server = net.createServer();
        server.once('error', () => {
          // 端口仍被占用
          server.close();
          setTimeout(check, 300);
        });
        server.once('listening', () => {
          // 端口已空闲，关闭测试服务
          server.close();
          this.log(`[NapCatManager] 端口 ${port} 已释放`);
          resolve();
        });
        server.listen(port, '127.0.0.1');
      };
      check();
    });
  }

  /**
   * 增强启动错误信息，提供可操作的反馈
   */
  private enhanceStartupError(msg: string): string {
    if (msg.includes('token is invalid')) {
      return 'WebUI 认证失败（token 无效）。已清理残留进程，请重试。';
    }
    if (msg.includes('已登录') || msg.includes('重复登录')) {
      return 'QQ 账号已在其他会话中登录，已强制清理旧会话，请重试。';
    }
    if (msg.includes('WebUI 已就绪')) {
      return 'NapCat WebUI 端口被占用（可能是旧进程未退出），已自动清理，请重试。';
    }
    return msg;
  }
}

/** 创建 NapCatManager 的便捷工厂 */
export function createNapCatManager(options: NapCatManagerOptions): NapCatManager {
  return new NapCatManager(options);
}
