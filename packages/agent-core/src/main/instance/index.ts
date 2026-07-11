/**
 * 实例模块 - 管理 Adapter Core 实例配置文件
 *
 * 子模块：
 * - instance-validator: 实例 JSON 校验器
 * - instance-manager: 实例管理器（导入/CRUD/持久化）
 * - offline-access: 离线访问支持
 */

export { InstanceValidator, type ValidationResult, type InstanceConfig } from './instance-validator';
export { InstanceManager, type ImportResult } from './instance-manager';
export { InstanceStore } from './instance-store';
export { OfflineAccess, type OfflineWorkspaceData } from './offline-access';
