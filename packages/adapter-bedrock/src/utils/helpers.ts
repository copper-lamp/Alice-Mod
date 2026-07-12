/**
 * 工具函数
 */

import { DIMENSION_NAMES, GAME_MODE_NAMES } from './constants.js';

/**
 * 从视角方向计算偏移后的坐标
 */
export function calcPosFromViewDirection(
  origin: { x: number; y: number; z: number; dimid: number },
  direction: { yaw: number },
  distance: number,
): FloatPos {
  const yaw = ((direction.yaw + 180) / 180) * Math.PI;
  const vector = [Math.sin(yaw) * distance, 0, -Math.cos(yaw) * distance];
  return new FloatPos(
    origin.x + vector[0],
    origin.y,
    origin.z + vector[2],
    origin.dimid,
  );
}

/**
 * 获取实体脚部坐标
 * 优先使用 entity.feetPos，降级为 entity.pos - 1.62
 */
export function getEntityFeetPos(entity: any): FloatPos {
  const feetPos = entity.feetPos;
  if (feetPos) {
    return feetPos;
  }
  const pos = entity.pos;
  return new FloatPos(pos.x, pos.y - 1.62, pos.z, pos.dimid);
}

/**
 * 解析 "x y z" 或 "x,y,z" 字符串为坐标对象
 */
export function parsePositionString(
  str: string,
): { x: number; y: number; z: number } | null {
  if (str.length === 0) return null;

  let cleaned = str;
  if (cleaned.startsWith('(')) cleaned = cleaned.substring(1);
  if (cleaned.endsWith(')')) cleaned = cleaned.substring(0, cleaned.length - 1);

  let splitter = '';
  if (cleaned.indexOf(' ') !== -1) splitter = ' ';
  else if (cleaned.indexOf(',') !== -1) splitter = ',';
  else return null;

  const parts = cleaned.split(splitter);
  if (
    parts.length !== 3 ||
    parts[0].length === 0 ||
    parts[1].length === 0 ||
    parts[2].length === 0
  ) {
    return null;
  }

  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;

  return { x, y, z };
}

/**
 * 判断数值是否为整数
 */
export function isInteger(num: number): boolean {
  return num % 1 === 0;
}

/**
 * 验证维度 ID 是否有效
 */
export function isValidDimensionId(dimid: number): boolean {
  return isInteger(dimid) && dimid >= 0 && dimid < DIMENSION_NAMES.length;
}

/**
 * 获取游戏模式名称
 */
export function getGameModeName(mode: number): string {
  const name = GAME_MODE_NAMES[mode];
  if (name == null) return '默认模式';
  return name;
}

/**
 * 等待条件成立，带超时
 */
export function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}