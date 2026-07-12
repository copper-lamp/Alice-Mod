/**
 * 根据 ToolMetadata.input_schema 生成 LLSE CustomForm
 */

import type { ToolMetadata } from '../registry/tool-module.types.js';

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  [key: string]: unknown;
}

interface FieldMeta {
  key: string;
  type: 'enum' | 'boolean' | 'number' | 'string' | 'array' | 'coordinate' | 'json';
  enumValues?: (string | number | boolean)[];
}

export interface BuiltForm {
  form: CustomForm;
  parse(data: any[]): Record<string, unknown>;
}

const DANGEROUS_TOOLS = new Set(['mine_block', 'place_block', 'area_operation']);

export class ToolParamFormBuilder {
  /**
   * 为指定工具构建参数输入表单
   */
  static build(player: Player, metadata: ToolMetadata): BuiltForm {
    const form = mc.newCustomForm();
    form.setTitle(`§l测试: ${metadata.name}`);

    const schema = metadata.input_schema as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, SchemaProperty>;
    const required = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const fieldMeta: FieldMeta[] = [];

    // 危险操作提示
    if (DANGEROUS_TOOLS.has(metadata.name)) {
      form.addLabel('§c注意：此工具会修改世界方块，请在测试区域使用。');
    }

    for (const [key, prop] of Object.entries(properties)) {
      const title = `${key}${required.has(key) ? ' *' : ''}`;

      if (prop.enum && prop.enum.length > 0) {
        const items = prop.enum.map((v) => String(v));
        const defIndex = prop.default !== undefined
          ? Math.max(0, prop.enum.indexOf(prop.default as string | number | boolean))
          : 0;
        form.addDropdown(title, items, defIndex);
        fieldMeta.push({ key, type: 'enum', enumValues: prop.enum });
      } else if (prop.type === 'boolean') {
        form.addSwitch(title, prop.default === true);
        fieldMeta.push({ key, type: 'boolean' });
      } else if (prop.type === 'number') {
        const def = this.getCoordinateDefault(player, key, prop.default as number | undefined);
        form.addInput(title, '', String(def));
        fieldMeta.push({ key, type: 'number' });
      } else if (prop.type === 'string') {
        const def = this.getStringDefault(player, key, prop.default as string | undefined);
        form.addInput(title, '', def);
        fieldMeta.push({ key, type: 'string' });
      } else if (prop.type === 'array') {
        const def = prop.default !== undefined && Array.isArray(prop.default)
          ? prop.default.join(',')
          : '';
        form.addInput(title, '逗号分隔', def);
        fieldMeta.push({ key, type: 'array' });
      } else if (prop.type === 'object' && this.isCoordinateObject(prop)) {
        form.addInput(`${title}.x`, '', String(this.getCoordinateDefault(player, 'x')));
        form.addInput(`${title}.y`, '', String(this.getCoordinateDefault(player, 'y')));
        form.addInput(`${title}.z`, '', String(this.getCoordinateDefault(player, 'z')));
        fieldMeta.push({ key, type: 'coordinate' });
      } else {
        // 降级为 JSON 文本输入
        const def = prop.default !== undefined ? JSON.stringify(prop.default) : '';
        form.addInput(title, 'JSON', def);
        fieldMeta.push({ key, type: 'json' });
      }
    }

    return {
      form,
      parse: (data: any[]) => this.parseData(data, fieldMeta),
    };
  }

  /**
   * 解析 CustomForm 返回的数据数组
   */
  private static parseData(data: any[], fieldMeta: FieldMeta[]): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    let idx = 0;

    for (const field of fieldMeta) {
      if (field.type === 'coordinate') {
        params[field.key] = {
          x: Number(data[idx++]),
          y: Number(data[idx++]),
          z: Number(data[idx++]),
        };
      } else {
        const raw = data[idx++];
        switch (field.type) {
          case 'enum':
            if (field.enumValues) {
              const selected = field.enumValues[Number(raw)];
              params[field.key] = selected ?? raw;
            } else {
              params[field.key] = raw;
            }
            break;
          case 'boolean':
            params[field.key] = Boolean(raw);
            break;
          case 'number':
            params[field.key] = Number(raw);
            break;
          case 'array': {
            const str = String(raw || '');
            params[field.key] = str ? str.split(',').map((s) => s.trim()) : [];
            break;
          }
          case 'json': {
            const text = String(raw || '');
            try {
              params[field.key] = text ? JSON.parse(text) : null;
            } catch {
              params[field.key] = text;
            }
            break;
          }
          case 'string':
          default:
            params[field.key] = raw;
            break;
        }
      }
    }

    return params;
  }

  /**
   * 判断对象是否为坐标对象（含 x/y/z）
   */
  private static isCoordinateObject(prop: SchemaProperty): boolean {
    if (!prop.properties) return false;
    return 'x' in prop.properties && 'y' in prop.properties && 'z' in prop.properties;
  }

  /**
   * 获取坐标类字段默认值
   */
  private static getCoordinateDefault(player: Player, key: string, fallback?: number): number {
    const viewBlock = player.getBlockFromViewVector();
    const viewPos = viewBlock ? viewBlock.pos : null;

    if (key === 'x') {
      return viewPos ? viewPos.x : Math.floor(player.pos.x);
    }
    if (key === 'y') {
      return viewPos ? viewPos.y : Math.floor(player.pos.y);
    }
    if (key === 'z') {
      return viewPos ? viewPos.z : Math.floor(player.pos.z);
    }
    return fallback ?? 0;
  }

  /**
   * 获取字符串类字段默认值
   */
  private static getStringDefault(player: Player, key: string, fallback?: string): string {
    if (key === 'block_name') return 'stone';
    if (key === 'item_name') {
      const hand = player.getHand();
      return hand.isNull() ? 'apple' : hand.name;
    }
    if (fallback !== undefined) return String(fallback);
    return '';
  }
}
