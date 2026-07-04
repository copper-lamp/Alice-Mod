import { describe, it, expect } from 'vitest';
import { Workspace, WorkspaceState } from '../../src/main/workspace/workspace';

describe('Workspace', () => {
  it('should create with required params', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    expect(ws.instanceId).toBe('test-1');
    expect(ws.name).toBe('test-1');
    expect(ws.state).toBe(WorkspaceState.Offline);
    expect(ws.isOnline).toBe(false);
    expect(ws.toolCount).toBe(0);
    expect(ws.id).toBeDefined();
    expect(ws.createdAt).toBeGreaterThan(0);
  });

  it('should create with optional params', () => {
    const ws = new Workspace({ instanceId: 'test-2', name: 'My Server', edition: 'bedrock', source: 'manual' });
    expect(ws.name).toBe('My Server');
    expect(ws.edition).toBe('bedrock');
    expect(ws.source).toBe('manual');
  });

  it('should transition to connecting state', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    ws.goConnecting('conn-1');
    expect(ws.state).toBe(WorkspaceState.Connecting);
    expect(ws.connectionId).toBe('conn-1');
  });

  it('should transition to online state', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    ws.goConnecting('conn-1');
    ws.goOnline();
    expect(ws.state).toBe(WorkspaceState.Online);
    expect(ws.isOnline).toBe(true);
    expect(ws.lastOnlineAt).toBeGreaterThan(0);
  });

  it('should transition to offline state', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    ws.goConnecting('conn-1');
    ws.goOnline();
    ws.goOffline();
    expect(ws.state).toBe(WorkspaceState.Offline);
    expect(ws.isOnline).toBe(false);
    expect(ws.connectionId).toBeNull();
  });

  it('should update tools', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    const tools = [{ name: 'move_to', description: '', category: 'movement' as const, parameters: {} }];
    ws.updateTools(tools);
    expect(ws.toolCount).toBe(1);
    expect(ws.tools[0].name).toBe('move_to');
  });

  it('should update version info', () => {
    const ws = new Workspace({ instanceId: 'test-1' });
    ws.updateVersion('bedrock', '1.0.0', 'fabric-0.16');
    expect(ws.edition).toBe('bedrock');
    expect(ws.protocolVersion).toBe('1.0.0');
    expect(ws.modVersion).toBe('fabric-0.16');
  });

  it('should serialize to JSON', () => {
    const ws = new Workspace({ instanceId: 'test-1', name: 'Test', edition: 'java' });
    ws.goConnecting('conn-1');
    ws.goOnline();

    const data = ws.toJSON();
    expect(data.instanceId).toBe('test-1');
    expect(data.name).toBe('Test');
    expect(data.state).toBe('online');
    expect(data.toolCount).toBe(0);
    expect(data.connectionId).toBe('conn-1');
  });
});
