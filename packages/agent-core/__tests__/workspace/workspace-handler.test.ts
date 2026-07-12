/**
 * 工作区 IPC Handler 测试
 *
 * 覆盖场景：
 * - 标准格式（alice-mod_instance.json with instances[]）
 * - 协议文档标准格式（嵌套 game_version/tcp/auth）
 * - BE 插件旧格式（扁平 game/network）
 * - 非法格式
 * - 完整工作流（validate → create）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { InstanceManager } from '../../src/main/instance/instance-manager'
import { InstanceValidator } from '../../src/main/instance/instance-validator'

// ════════════════════════════════════════════════════════════════
// 待测试的核心解析逻辑
// ════════════════════════════════════════════════════════════════

interface BEPluginJson {
  instance_id?: string
  _schema_version?: string
  mod_version?: string
  game?: { edition?: string }
  network?: { host?: string; port?: number }
  description?: string
}

function isBEPluginFormat(json: unknown): json is BEPluginJson {
  if (typeof json !== 'object' || json === null) return false
  const obj = json as Record<string, unknown>
  return typeof obj.instance_id === 'string' && !Array.isArray(obj.instances)
}

/** 解析协议文档标准格式（嵌套 game_version/tcp/auth） */
function isProtocolFormat(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false
  const obj = json as Record<string, unknown>
  return (
    typeof obj.schema_version === 'string' &&
    typeof obj.instance_id === 'string' &&
    typeof obj.instance_name === 'string' &&
    typeof obj.game_version === 'object' &&
    obj.game_version !== null &&
    typeof obj.tcp === 'object' &&
    obj.tcp !== null
  )
}

/** 将协议格式或旧 BE 格式解析为 ImportResult */
function parseNonStandardFile(filePath: string): {
  success: boolean
  instances: Array<{
    instance_id: string
    name: string
    edition: 'bedrock' | 'java'
    host: string
    port: number
    auth_token: string
    file_path?: string
    description?: string
    tags?: string[]
  }>
  errors: string[]
} {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content)

    // 1) 协议文档标准格式
    if (isProtocolFormat(parsed)) {
      const edition = (parsed.game_version as { edition?: string }).edition === 'java' ? 'java' : 'bedrock'
      const tcp = parsed.tcp as { host?: string; port?: number }
      const auth = parsed.auth as { token?: string } | undefined
      const host = tcp?.host ?? '127.0.0.1'
      const port = tcp?.port ?? 27541
      const authToken = auth?.token ?? `auto-${parsed.instance_id!.slice(0, 8)}`

      const config = {
        instance_id: parsed.instance_id!,
        name: parsed.instance_name!,
        edition,
        host,
        port,
        auth_token: authToken,
        file_path: filePath,
        description: parsed.description as string | undefined,
      }

      const errs = InstanceValidator.validateInstance(config)
      if (errs.length > 0) {
        return { success: false, instances: [], errors: errs }
      }
      return { success: true, instances: [config], errors: [] }
    }

    // 2) 旧 BE 插件格式
    if (isBEPluginFormat(parsed)) {
      const edition = parsed.game?.edition === 'java' ? 'java' : 'bedrock'
      const host = parsed.network?.host ?? '127.0.0.1'
      const port = parsed.network?.port ?? 27541
      const name = parsed.mod_version
        ? `${edition === 'bedrock' ? 'BE' : 'JE'} v${parsed.mod_version}`
        : path.basename(path.dirname(filePath))

      const config = {
        instance_id: parsed.instance_id!,
        name,
        edition,
        host,
        port,
        auth_token: `auto-${parsed.instance_id!.slice(0, 8)}`,
        file_path: filePath,
        description: parsed.description,
      }

      const errs = InstanceValidator.validateInstance(config)
      if (errs.length > 0) {
        return { success: false, instances: [], errors: errs }
      }
      return { success: true, instances: [config], errors: [] }
    }

    return { success: false, instances: [], errors: ['不支持的 JSON 格式'] }
  } catch (err) {
    return {
      success: false,
      instances: [],
      errors: [`解析文件失败: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 测试用例
// ════════════════════════════════════════════════════════════════

describe('isBEPluginFormat', () => {
  it('should detect BE plugin format', () => {
    expect(isBEPluginFormat({ instance_id: 'abc', _schema_version: '1.0' })).toBe(true)
  })

  it('should reject standard format with instances array', () => {
    expect(isBEPluginFormat({ instances: [] })).toBe(false)
  })

  it('should reject null/undefined', () => {
    expect(isBEPluginFormat(null)).toBe(false)
    expect(isBEPluginFormat(undefined)).toBe(false)
  })

  it('should reject non-object', () => {
    expect(isBEPluginFormat('string')).toBe(false)
    expect(isBEPluginFormat(123)).toBe(false)
  })
})

describe('isProtocolFormat', () => {
  it('should detect protocol doc format', () => {
    const json = {
      schema_version: '1.0.0',
      instance_id: 'abc',
      instance_name: 'Test',
      game_version: { edition: 'bedrock' },
      tcp: { host: '127.0.0.1', port: 27541 },
    }
    expect(isProtocolFormat(json)).toBe(true)
  })

  it('should reject BE plugin format', () => {
    expect(isProtocolFormat({ instance_id: 'abc', game: {} })).toBe(false)
  })
})

describe('parseNonStandardFile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-handler-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeJson(name: string, data: unknown): string {
    const fp = path.join(tempDir, name)
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8')
    return fp
  }

  // ─── 协议文档标准格式 ───
  it('should parse protocol doc format (full)', () => {
    const fp = writeJson('alice-mod_instance.json', {
      schema_version: '1.0.0',
      instance_id: '8d7cade2-b46e-4188-9602-936044927c77',
      instance_name: 'Alice Mod',
      game_version: { edition: 'bedrock', version: 'v1.26.10' },
      mod_version: '1.0.0',
      status: { online: false },
      tcp: { host: '127.0.0.1', port: 27541 },
      auth: { token: 'mct_3c380c6e46057c4a2e01e32e3134ee48' },
      database: { sqlite_path: '/data/alice-mod.db' },
      toolset_info: { total_tools: 0, tool_categories: [] },
    })

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(true)
    expect(result.instances).toHaveLength(1)

    const inst = result.instances[0]
    expect(inst.instance_id).toBe('8d7cade2-b46e-4188-9602-936044927c77')
    expect(inst.name).toBe('Alice Mod')
    expect(inst.edition).toBe('bedrock')
    expect(inst.host).toBe('127.0.0.1')
    expect(inst.port).toBe(27541)
    expect(inst.auth_token).toBe('mct_3c380c6e46057c4a2e01e32e3134ee48')
    expect(inst.file_path).toBe(fp)
  })

  it('should parse protocol format without auth (auto-generate token)', () => {
    const fp = writeJson('no-auth.json', {
      schema_version: '1.0.0',
      instance_id: 'abc-123',
      instance_name: 'No Auth Server',
      game_version: { edition: 'java' },
      tcp: { host: '10.0.0.1', port: 27542 },
    })

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(true)
    const inst = result.instances[0]
    expect(inst.edition).toBe('java')
    expect(inst.host).toBe('10.0.0.1')
    expect(inst.port).toBe(27542)
    expect(inst.auth_token).toMatch(/^auto-/)
  })

  it('should parse protocol format with Java edition', () => {
    const fp = writeJson('java.json', {
      schema_version: '1.0.0',
      instance_id: 'je-001',
      instance_name: 'Java Server',
      game_version: { edition: 'java' },
      tcp: { host: '10.0.0.2', port: 27541 },
    })

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(true)
    expect(result.instances[0].edition).toBe('java')
  })

  // ─── 旧 BE 插件格式 ───

  it('should parse old BE plugin format', () => {
    const fp = writeJson('instance.json', {
      _schema_version: '1.0.0',
      instance_id: '138b51c6-d8e7-4fcc-81c2-ede53df7200b',
      mod_version: '1.0.0',
      game: { edition: 'bedrock', version: 'v1.26.10' },
      network: { protocol: 'json-rpc-2.0', transport: 'tcp', host: '127.0.0.1', port: 27541 },
      status: { online: false },
      capabilities: { tools_count: 0, max_bots: 3 },
    })

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(true)
    expect(result.instances).toHaveLength(1)

    const inst = result.instances[0]
    expect(inst.instance_id).toBe('138b51c6-d8e7-4fcc-81c2-ede53df7200b')
    expect(inst.name).toBe('BE v1.0.0')
    expect(inst.edition).toBe('bedrock')
    expect(inst.host).toBe('127.0.0.1')
    expect(inst.port).toBe(27541)
    expect(inst.auth_token).toMatch(/^auto-/)
    expect(inst.file_path).toBe(fp)
  })

  it('should parse BE format without mod_version (use dirname)', () => {
    const subDir = fs.mkdtempSync(path.join(tempDir, 'myserver-'))
    const fp = path.join(subDir, 'instance.json')
    fs.writeFileSync(fp, JSON.stringify({
      instance_id: 'no-mod',
      game: { edition: 'bedrock' },
      network: { host: '10.0.0.3', port: 27543 },
    }), 'utf-8')

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(true)
    expect(result.instances[0].name).toMatch(/^myserver/)
  })

  // ─── 标准 InstanceManager 格式 ───

  it('should parse standard InstanceManager format', () => {
    const fp = writeJson('standard.json', {
      schema_version: '1.0',
      instances: [{
        instance_id: 'std-01',
        name: 'Standard Server',
        edition: 'bedrock',
        host: '192.168.1.1',
        port: 27541,
        auth_token: 'sk-test',
      }],
    })

    const manager = new InstanceManager(path.join(tempDir, 'instances.json'))
    const result = manager.importFromFile(fp)
    expect(result.success).toBe(true)
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0].instance_id).toBe('std-01')
  })

  // ─── 非法格式 ───

  it('should reject invalid JSON', () => {
    const fp = path.join(tempDir, 'bad.json')
    fs.writeFileSync(fp, 'not json', 'utf-8')

    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should reject unsupported format', () => {
    const fp = writeJson('unknown.json', { foo: 'bar' })
    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(false)
  })

  it('should reject empty object', () => {
    const fp = writeJson('empty.json', {})
    const result = parseNonStandardFile(fp)
    expect(result.success).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// 完整工作流集成测试
// ════════════════════════════════════════════════════════════════

describe('workspace workflow integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-workflow-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeJson(name: string, data: unknown): string {
    const fp = path.join(tempDir, name)
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8')
    return fp
  }

  /** 模拟快速连接流程 — validate → create */
  async function simulateQuickConnect(
    filePath: string,
    instanceManager: InstanceManager,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      // Step 1: Read and parse file
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content)

      // Try standard format first (with instances array)
      const hasInstances = Array.isArray((parsed as any).instances)

      let instanceConfig: {
        instance_id: string
        name: string
        edition: 'bedrock' | 'java'
        host: string
        port: number
        auth_token: string
        file_path?: string
      }

      if (hasInstances) {
        const result = instanceManager.importFromFile(filePath)
        if (!result.success) return { success: false, error: result.errors.join('; ') }
        instanceConfig = { ...result.instances[0] }
      } else {
        const result = parseNonStandardFile(filePath)
        if (!result.success) return { success: false, error: result.errors.join('; ') }
        instanceConfig = { ...result.instances[0] }
      }

      // Step 2: Persist instance config
      instanceManager.add({
        instance_id: instanceConfig.instance_id,
        name: instanceConfig.name,
        edition: instanceConfig.edition,
        host: instanceConfig.host,
        port: instanceConfig.port,
        auth_token: instanceConfig.auth_token,
        file_path: filePath,
      })

      return { success: true, id: instanceConfig.instance_id }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  it('should complete full workflow with protocol doc format', async () => {
    const fp = writeJson('alice-mod_instance.json', {
      schema_version: '1.0.0',
      instance_id: '8d7cade2-b46e-4188-9602-936044927c77',
      instance_name: 'Alice Mod',
      game_version: { edition: 'bedrock', version: 'v1.26.10' },
      mod_version: '1.0.0',
      tcp: { host: '127.0.0.1', port: 27541 },
      auth: { token: 'mct_3c380c6e46057c4a2e01e32e3134ee48' },
    })

    const manager = new InstanceManager(path.join(tempDir, 'store.json'))
    const result = await simulateQuickConnect(fp, manager)

    expect(result.success).toBe(true)
    expect(result.id).toBe('8d7cade2-b46e-4188-9602-936044927c77')

    const saved = manager.get('8d7cade2-b46e-4188-9602-936044927c77')
    expect(saved).toBeDefined()
    expect(saved!.name).toBe('Alice Mod')
    expect(saved!.edition).toBe('bedrock')
    expect(saved!.host).toBe('127.0.0.1')
    expect(saved!.port).toBe(27541)
    expect(saved!.auth_token).toBe('mct_3c380c6e46057c4a2e01e32e3134ee48')
    expect(saved!.file_path).toBe(fp)
  })

  it('should complete full workflow with old BE plugin format', async () => {
    const fp = writeJson('instance.json', {
      _schema_version: '1.0.0',
      instance_id: '138b51c6-d8e7-4fcc-81c2-ede53df7200b',
      mod_version: '1.0.0',
      game: { edition: 'bedrock' },
      network: { host: '127.0.0.1', port: 27541 },
    })

    const manager = new InstanceManager(path.join(tempDir, 'store.json'))
    const result = await simulateQuickConnect(fp, manager)

    expect(result.success).toBe(true)
    const saved = manager.get('138b51c6-d8e7-4fcc-81c2-ede53df7200b')
    expect(saved).toBeDefined()
    expect(saved!.name).toBe('BE v1.0.0')
  })

  it('should complete full workflow with standard format', async () => {
    const fp = writeJson('standard.json', {
      schema_version: '1.0',
      instances: [{
        instance_id: 'std-001',
        name: 'Standard',
        edition: 'java',
        host: '10.0.0.1',
        port: 27541,
        auth_token: 'sk-test',
      }],
    })

    const manager = new InstanceManager(path.join(tempDir, 'store.json'))
    const result = await simulateQuickConnect(fp, manager)

    expect(result.success).toBe(true)
    expect(result.id).toBe('std-001')
  })

  it('should reject invalid file in workflow', async () => {
    const fp = path.join(tempDir, 'bad.json')
    fs.writeFileSync(fp, '{invalid}', 'utf-8')

    const manager = new InstanceManager(path.join(tempDir, 'store.json'))
    const result = await simulateQuickConnect(fp, manager)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should use real instance.json file if available', async () => {
    // 尝试读取真实的 instance.json 进行集成验证
    const realPaths = [
      'd:\\McAgent\\bds26.10\\Alice\\alice-mod_instance.json',
      'd:\\McAgent\\bds26.10\\Alice\\instance.json',
    ]

    for (const realPath of realPaths) {
      if (fs.existsSync(realPath)) {
        const manager = new InstanceManager(path.join(tempDir, 'store.json'))
        const result = await simulateQuickConnect(realPath, manager)
        expect(result.success).toBe(true)
        const saved = manager.getAll()
        expect(saved.length).toBeGreaterThan(0)
        console.log(`[集成] 成功解析: ${realPath}`)
        console.log(`[集成] 实例名称: ${saved[0].name}, 版本: ${saved[0].edition}`)
        return
      }
    }

    console.log('[集成] 未找到真实 instance.json 文件，跳过集成验证')
  })
})
