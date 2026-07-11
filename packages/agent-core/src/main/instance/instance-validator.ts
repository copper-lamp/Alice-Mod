/**
 * 实例 JSON 校验器
 *
 * 校验 `alice-mod_instance.json` 文件的格式合法性。
 */

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 实例配置（单个实例） */
export interface InstanceConfig {
  instance_id: string;
  name: string;
  edition: 'bedrock' | 'java';
  host: string;
  port: number;
  auth_token: string;
  file_path?: string;        // 来源 JSON 文件路径
  game_version?: string;     // 游戏版本号，如 "1.26.10"
  icon_data?: string;        // 自定义图标 base64
  description?: string;
  tags?: string[];
}

/** 支持的 schema 版本 */
const SUPPORTED_SCHEMA_VERSIONS = ['1.0'];

/**
 * 实例校验器
 */
export class InstanceValidator {
  /**
   * 校验完整的 JSON 文件内容
   */
  static validate(json: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof json !== 'object' || json === null) {
      return { valid: false, errors: ['Root must be a JSON object'] };
    }

    const root = json as Record<string, unknown>;

    // 校验 schema_version
    if (typeof root.schema_version !== 'string') {
      errors.push('Missing or invalid "schema_version" (must be a string)');
    } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(root.schema_version)) {
      errors.push(`Unsupported schema version: "${root.schema_version}". Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
    }

    // 校验 instances
    if (!Array.isArray(root.instances)) {
      errors.push('Missing or invalid "instances" (must be an array)');
      return { valid: errors.length === 0, errors };
    }

    if (root.instances.length === 0) {
      errors.push('"instances" array is empty');
    }

    // 校验每个实例
    const seenIds = new Set<string>();
    for (let i = 0; i < root.instances.length; i++) {
      const instanceErrors = InstanceValidator.validateInstance(root.instances[i], seenIds);
      errors.push(...instanceErrors.map((e) => `instances[${i}]: ${e}`));
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 校验单个实例配置
   */
  static validateInstance(config: unknown, seenIds?: Set<string>): string[] {
    const errors: string[] = [];

    if (typeof config !== 'object' || config === null) {
      return ['Instance must be a JSON object'];
    }

    const inst = config as Record<string, unknown>;

    // instance_id
    if (typeof inst.instance_id !== 'string' || inst.instance_id.trim() === '') {
      errors.push('Missing or invalid "instance_id" (must be a non-empty string)');
    } else if (seenIds) {
      if (seenIds.has(inst.instance_id)) {
        errors.push(`Duplicate instance_id: "${inst.instance_id}"`);
      }
      seenIds.add(inst.instance_id);
    }

    // name
    if (typeof inst.name !== 'string' || inst.name.trim() === '') {
      errors.push('Missing or invalid "name" (must be a non-empty string)');
    }

    // edition
    if (inst.edition !== 'bedrock' && inst.edition !== 'java') {
      errors.push('Invalid "edition" (must be "bedrock" or "java")');
    }

    // host
    if (typeof inst.host !== 'string' || inst.host.trim() === '') {
      errors.push('Missing or invalid "host" (must be a non-empty string)');
    }

    // port
    if (typeof inst.port !== 'number' || !Number.isInteger(inst.port) || inst.port < 1 || inst.port > 65535) {
      errors.push('Invalid "port" (must be an integer between 1 and 65535)');
    }

    // auth_token
    if (typeof inst.auth_token !== 'string' || inst.auth_token.trim() === '') {
      errors.push('Missing or invalid "auth_token" (must be a non-empty string)');
    }

    // description (optional)
    if (inst.description !== undefined && typeof inst.description !== 'string') {
      errors.push('"description" must be a string');
    }

    // tags (optional)
    if (inst.tags !== undefined) {
      if (!Array.isArray(inst.tags) || !inst.tags.every((t: unknown) => typeof t === 'string')) {
        errors.push('"tags" must be an array of strings');
      }
    }

    return errors;
  }

  /**
   * 从 JSON 字符串解析并校验
   */
  static validateJsonString(jsonStr: string): ValidationResult {
    try {
      const parsed = JSON.parse(jsonStr);
      return InstanceValidator.validate(parsed);
    } catch {
      return { valid: false, errors: ['Invalid JSON string'] };
    }
  }

  /**
   * 将原始对象转为 InstanceConfig（假设已通过校验）
   */
  static toInstanceConfig(raw: Record<string, unknown>): InstanceConfig {
    return {
      instance_id: String(raw.instance_id),
      name: String(raw.name),
      edition: raw.edition as 'bedrock' | 'java',
      host: String(raw.host),
      port: Number(raw.port),
      auth_token: String(raw.auth_token),
      file_path: raw.file_path ? String(raw.file_path) : undefined,
      game_version: raw.game_version ? String(raw.game_version) : undefined,
      icon_data: raw.icon_data ? String(raw.icon_data) : undefined,
      description: raw.description ? String(raw.description) : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    };
  }
}
