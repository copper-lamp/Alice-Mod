/**
 * copy-to-bds.js
 *
 * 编译后自动将产物 (dist/) 及配置文件复制到 BDS 插件目录
 * BDS 位置: d:\McAgent\bds26.10
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');
const BDS_PLUGIN_DIR = path.resolve(
  __dirname, '..', '..', '..', 'bds26.10', 'plugins', 'Alices Mod'
);

function copyRecursive(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// 复制 dist/ 编译产物
console.log(`[copy-to-bds] 复制编译产物 → ${BDS_PLUGIN_DIR}`);
const start = Date.now();
copyRecursive(DIST_DIR, BDS_PLUGIN_DIR);

// 复制 manifest.json（插件入口描述，覆盖 BDS 目录现有文件）
const manifestSrc = path.join(PACKAGE_DIR, 'manifest.json');
const manifestDst = path.join(BDS_PLUGIN_DIR, 'manifest.json');
fs.copyFileSync(manifestSrc, manifestDst);
console.log(`[copy-to-bds] 已复制: manifest.json`);

const elapsed = Date.now() - start;
console.log(`[copy-to-bds] 完成 (${elapsed}ms)`);
