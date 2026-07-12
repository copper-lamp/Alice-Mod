import { describe, it, expect, vi } from 'vitest';
import { WorkspaceManager, WorkspaceEvent } from '../../src/main/workspace/workspace-manager';
import { WorkspaceState } from '../../src/main/workspace/workspace';

describe('WorkspaceManager', () => {
  it('should create a workspace', () => {
    const wm = new WorkspaceManager(false);
    const ws = wm.createWorkspace({ instanceId: 'test-1', edition: 'bedrock' });

    expect(ws.instanceId).toBe('test-1');
    expect(ws.edition).toBe('bedrock');
    expect(wm.totalCount).toBe(1);
    expect(wm.onlineCount).toBe(0);
  });

  it('should return existing workspace for duplicate instanceId', () => {
    const wm = new WorkspaceManager(false);
    const ws1 = wm.createWorkspace({ instanceId: 'test-1' });
    const ws2 = wm.createWorkspace({ instanceId: 'test-1' });

    expect(ws1).toBe(ws2);
    expect(wm.totalCount).toBe(1);
  });

  it('should find workspace by various indexes', () => {
    const wm = new WorkspaceManager(false);
    const ws = wm.createWorkspace({ instanceId: 'test-1' });

    wm.setConnecting('test-1', 'conn-1');
    expect(wm.getWorkspace(ws.id)).toBe(ws);
    expect(wm.getWorkspaceByInstanceId('test-1')).toBe(ws);
    expect(wm.getWorkspaceByConnectionId('conn-1')).toBe(ws);
  });

  it('should transition workspace states', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1' });

    wm.setConnecting('test-1', 'conn-1');
    let ws = wm.getWorkspaceByInstanceId('test-1')!;
    expect(ws.state).toBe(WorkspaceState.Connecting);

    wm.setOnline('test-1', 'conn-1');
    ws = wm.getWorkspaceByInstanceId('test-1')!;
    expect(ws.state).toBe(WorkspaceState.Online);

    wm.setOffline('conn-1');
    ws = wm.getWorkspaceByInstanceId('test-1')!;
    expect(ws.state).toBe(WorkspaceState.Offline);
  });

  it('should set offline by connectionId', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1' });
    wm.setOnline('test-1', 'conn-1');
    wm.setOffline('conn-1');

    const ws = wm.getWorkspaceByInstanceId('test-1')!;
    expect(ws.state).toBe(WorkspaceState.Offline);
    expect(ws.connectionId).toBeNull();
  });

  it('should register tools to workspace', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1' });
    const ws = wm.getWorkspaceByInstanceId('test-1')!;

    wm.registerTools(ws.id, [
      { name: 'move_to', description: '', category: 'movement' as const, parameters: {} },
    ]);

    expect(ws.toolCount).toBeGreaterThanOrEqual(1);
    expect(wm.getWorkspaceTools(ws.id).length).toBeGreaterThanOrEqual(1);
  });

  it('should emit events on state changes', () => {
    const wm = new WorkspaceManager(false);
    const createdSpy = vi.fn();
    const stateSpy = vi.fn();

    wm.on(WorkspaceEvent.Created, createdSpy);
    wm.on(WorkspaceEvent.StateChanged, stateSpy);

    wm.createWorkspace({ instanceId: 'test-1' });
    expect(createdSpy).toHaveBeenCalledTimes(1);

    wm.setOnline('test-1', 'conn-1');
    expect(stateSpy).toHaveBeenCalled();
    const eventData = stateSpy.mock.calls[0][0];
    expect(eventData.instanceId).toBe('test-1');
  });

  it('should emit events on tool registration', () => {
    const wm = new WorkspaceManager(false);
    const spy = vi.fn();
    wm.on(WorkspaceEvent.ToolsUpdated, spy);

    const ws = wm.createWorkspace({ instanceId: 'test-1' });
    wm.registerTools(ws.id, [{ name: 'dig', description: '', category: 'movement' as const, parameters: {} }]);

    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][0];
    expect(event.metadata?.toolCount).toBeGreaterThanOrEqual(1);
  });

  it('should remove workspace', () => {
    const wm = new WorkspaceManager(false);
    const ws = wm.createWorkspace({ instanceId: 'test-1' });

    expect(wm.totalCount).toBe(1);
    wm.removeWorkspace(ws.id);
    expect(wm.totalCount).toBe(0);
    expect(wm.getWorkspace(ws.id)).toBeUndefined();
  });

  it('should clear all workspaces', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1' });
    wm.createWorkspace({ instanceId: 'test-2' });

    expect(wm.totalCount).toBe(2);
    wm.clear();
    expect(wm.totalCount).toBe(0);
  });

  it('should get online workspaces', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1' });
    wm.createWorkspace({ instanceId: 'test-2' });

    wm.setOnline('test-1', 'conn-1');
    expect(wm.onlineCount).toBe(1);

    wm.setOnline('test-2', 'conn-2');
    expect(wm.onlineCount).toBe(2);
  });

  it('should export all workspace data', () => {
    const wm = new WorkspaceManager(false);
    wm.createWorkspace({ instanceId: 'test-1', name: 'Server 1' });

    const data = wm.exportAll();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Server 1');
  });
});
