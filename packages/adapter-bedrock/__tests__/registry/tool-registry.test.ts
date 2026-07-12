/**
 * ToolRegistry 单元测试
 *
 * 验证工具注册器的目录发现、手动注册、分类查询和序列化功能。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../setup.js';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import type { IToolModule, ToolMetadata } from '../../src/registry/tool-module.types.js';

const FAKE_TOOL: IToolModule = {
  metadata(): ToolMetadata {
    return {
      name: 'fake_tool',
      description: '测试工具',
      category: 'inventory',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    };
  },
  async execute() {
    return { success: true, duration_ms: 0 };
  },
};

function mockFileSystem(structure: {
  dirs: string[];
  files: string[];
}) {
  const dirs = new Set(structure.dirs.map((d) => d.replace(/\\/g, '/').replace(/\/$/, '')));
  const files = new Set(structure.files.map((f) => f.replace(/\\/g, '/')));

  vi.spyOn(File, 'exists').mockImplementation((path: string) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
    return dirs.has(normalized) || files.has(normalized);
  });
  vi.spyOn(File, 'checkIsDir').mockImplementation((path: string) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
    return dirs.has(normalized);
  });
  vi.spyOn(File, 'getFilesList').mockImplementation((path: string) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
    const result = new Set<string>();
    for (const dir of dirs) {
      const parent = dir.substring(0, dir.lastIndexOf('/'));
      if (parent === normalized) {
        result.add(dir.substring(dir.lastIndexOf('/') + 1));
      }
    }
    for (const file of files) {
      const parent = file.substring(0, file.lastIndexOf('/'));
      if (parent === normalized) {
        result.add(file.substring(file.lastIndexOf('/') + 1));
      }
    }
    return Array.from(result);
  });
}

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('discoverToolDirs 应发现 tools/{category}/{tool} 结构', () => {
    mockFileSystem({
      dirs: [
        './plugins/Alices Mod/tools',
        './plugins/Alices Mod/tools/inventory',
        './plugins/Alices Mod/tools/inventory/drop-item',
        './plugins/Alices Mod/tools/inventory/equip-item',
        './plugins/Alices Mod/tools/movement',
        './plugins/Alices Mod/tools/movement/move-to',
      ],
      files: [
        './plugins/Alices Mod/tools/inventory/drop-item/index.js',
        './plugins/Alices Mod/tools/inventory/equip-item/index.js',
        './plugins/Alices Mod/tools/movement/move-to/index.js',
      ],
    });

    const registry = new ToolRegistry({ toolsDir: './plugins/Alices Mod/tools/' });
    const dirs = (registry as unknown as { discoverToolDirs(dir: string): string[] }).discoverToolDirs(
      './plugins/Alices Mod/tools/',
    );

    expect(dirs).toHaveLength(3);
    expect(dirs).toContain('./plugins/Alices Mod/tools/inventory/drop-item');
    expect(dirs).toContain('./plugins/Alices Mod/tools/inventory/equip-item');
    expect(dirs).toContain('./plugins/Alices Mod/tools/movement/move-to');
  });

  it('registerTool / get 应支持手动注册工具', () => {
    const registry = new ToolRegistry({ toolsDir: './tools/' });
    registry.registerTool('fake_tool', FAKE_TOOL.metadata(), FAKE_TOOL);

    const registered = registry.get('fake_tool');
    expect(registered).toBeDefined();
    expect(registered?.metadata.name).toBe('fake_tool');
    expect(registered?.metadata.category).toBe('inventory');
  });

  it('getByCategory 应按分类过滤工具', () => {
    const registry = new ToolRegistry({ toolsDir: './tools/' });
    registry.registerTool('tool_a', { ...FAKE_TOOL.metadata(), name: 'tool_a', category: 'inventory' }, FAKE_TOOL);
    registry.registerTool('tool_b', { ...FAKE_TOOL.metadata(), name: 'tool_b', category: 'movement' }, FAKE_TOOL);

    const inventoryTools = registry.getByCategory('inventory');
    expect(inventoryTools).toHaveLength(1);
    expect(inventoryTools[0].name).toBe('tool_a');
  });

  it('generateRegistrationPayload 应返回所有工具元数据', () => {
    const registry = new ToolRegistry({ toolsDir: './tools/' });
    registry.registerTool('fake_tool', FAKE_TOOL.metadata(), FAKE_TOOL);

    const payload = registry.generateRegistrationPayload();
    expect(payload).toHaveLength(1);
    expect(payload[0].name).toBe('fake_tool');
  });

  it('scanAndRegister 在工具目录不存在时应创建目录并返回 0', async () => {
    vi.spyOn(File, 'exists').mockReturnValue(false);
    vi.spyOn(File, 'mkdir').mockReturnValue(true);

    const registry = new ToolRegistry({ toolsDir: './missing/tools/' });
    const count = await registry.scanAndRegister();

    expect(File.mkdir).toHaveBeenCalledWith('./missing/tools/');
    expect(count).toBe(0);
  });
});
