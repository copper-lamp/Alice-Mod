/**
 * ensure-native.cjs
 *
 * 确保 better-sqlite3 原生模块已为当前运行时编译，避免手动切换。
 * 用法: node scripts/ensure-native.cjs <electron|node>
 *
 * 系统 Node.js 和 Electron 使用不同的 NODE_MODULE_VERSION：
 *   - Node.js 24  → 137
 *   - Electron 37 → 136
 * 原生模块 .node 文件只能匹配一个版本，每次切换运行时都需要重新编译。
 * 此脚本在测试/启动 Electron 前自动检测并重建。
 *
 * 注意：require('better-sqlite3') 只加载 JS 包装层，不触发原生模块加载。
 * 原生模块在 new Database() 时才通过 bindings 包加载。因此检测必须
 * 尝试 new Database(':memory:') 或直接检查 .node 文件是否存在。
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const target = process.argv[2];
if (!target || !['electron', 'node'].includes(target)) {
  console.error('[ensure-native] 用法: node scripts/ensure-native.cjs <electron|node>');
  process.exit(1);
}

const CWD = path.join(__dirname, '..');

/**
 * 检查 better-sqlite3 原生模块的 .node 文件是否存在
 */
function checkNodeFileExists() {
  try {
    // agent-core/node_modules/better-sqlite3 是到 pnpm store 的符号链接
    const modulePath = path.join(CWD, 'node_modules', 'better-sqlite3');
    const realModulePath = fs.realpathSync(modulePath);
    const nodeFilePath = path.join(realModulePath, 'build', 'Release', 'better_sqlite3.node');
    const exists = fs.existsSync(nodeFilePath);
    return { exists, path: nodeFilePath };
  } catch {
    return { exists: false, path: '' };
  }
}

/**
 * 尝试用 new Database(':memory:') 加载原生模块（这才是真正的加载检测）
 */
function tryLoadNativeModule() {
  try {
    execSync(
      `node -e "new (require('better-sqlite3'))(':memory:').close(); process.exit(0);"`,
      { cwd: CWD, stdio: 'pipe', timeout: 15000 },
    );
    return { ok: true };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const stdout = (e.stdout || '').toString();
    const msg = stderr || stdout || e.message;
    // 区分 NODE_MODULE_VERSION 不匹配 和 文件不存在
    if (msg.includes('NODE_MODULE_VERSION')) {
      return { ok: false, reason: 'NODE_MODULE_VERSION 不匹配（需要重新编译）' };
    }
    if (msg.includes('Could not locate the bindings file')) {
      return { ok: false, reason: '原生模块未编译（.node 文件不存在）' };
    }
    return { ok: false, reason: `加载失败: ${msg.substring(0, 200)}` };
  }
}

async function main() {
  const fileCheck = checkNodeFileExists();
  const loadCheck = tryLoadNativeModule();

  console.log(`[ensure-native] 目标: ${target}`);
  console.log(`[ensure-native] .node 文件: ${fileCheck.exists ? '存在' : '不存在'} (${fileCheck.path || 'N/A'})`);

  if (target === 'node') {
    // Node.js 目标：检测 + 有条件重建
    // 注意：tryLoadNativeModule() 用 node 运行时检测，对 Node.js 目标有效
    console.log(`[ensure-native] 原生模块加载: ${loadCheck.ok ? '成功' : '失败 - ' + (loadCheck.reason || '')}`);
    if (loadCheck.ok) {
      console.log('[ensure-native] better-sqlite3 已就绪，无需重建');
      return;
    }
    console.log('[ensure-native] 为 Node.js 重建 better-sqlite3...');
    try {
      execSync('npm rebuild better-sqlite3', { cwd: CWD, stdio: 'inherit', timeout: 120000 });
      console.log('[ensure-native] 重建完成');
    } catch (e) {
      console.error(`[ensure-native] 重建失败: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // Electron 目标：必须用 -f 强制重建
  // 注意：不能用 Node.js 的 tryLoadNativeModule() 检测 Electron 兼容性，
  // 因为 node 运行时检测的是 Node.js ABI（137），而 Electron 需要 ABI 136。
  // 不加 -f 时 electron-rebuild 可能错误地跳过重建（输出 "Rebuild Complete" 但实际未编译）。
  console.log('[ensure-native] 为 Electron 重建 better-sqlite3...');
  try {
    execSync('npx electron-rebuild -f -w better-sqlite3', {
      cwd: CWD,
      stdio: 'inherit',
      env: { ...process.env, npm_config_yes: 'true' },
      timeout: 120000,
    });
    console.log('[ensure-native] Electron 重建完成');
  } catch (e) {
    console.error(`[ensure-native] electron-rebuild 失败: ${e.message}`);
    process.exit(1);
  }

  // 重建后验证：如果 Node.js 仍能加载模块，说明编译未生效
  const verifyCheck = tryLoadNativeModule();
  if (verifyCheck.ok) {
    console.warn('[ensure-native] 警告: 重建后模块仍可被 Node.js 加载，可能未正确编译为 Electron 版本');
    console.warn('[ensure-native] 请尝试手动运行: npm run rebuild:native');
  } else {
    console.log(`[ensure-native] 验证: 模块已为 Electron 编译 (Node.js 加载: ${verifyCheck.reason})`);
  }
}

main().catch(e => {
  console.error(`[ensure-native] 脚本执行失败: ${e.message}`);
  process.exit(1);
});