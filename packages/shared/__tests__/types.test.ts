import { describe, it, expect } from 'vitest';
import { ErrorCode } from '../src/types/index.js';

describe('ErrorCode', () => {
  it('should have standard JSON-RPC error codes', () => {
    expect(ErrorCode.ParseError).toBe(-32700);
    expect(ErrorCode.InvalidRequest).toBe(-32600);
    expect(ErrorCode.MethodNotFound).toBe(-32601);
    expect(ErrorCode.InvalidParams).toBe(-32602);
    expect(ErrorCode.InternalError).toBe(-32603);
  });

  it('should have custom error codes aligned with spec', () => {
    expect(ErrorCode.ToolExecutionFailed).toBe(-32000);
    expect(ErrorCode.AuthFailed).toBe(-32001);
    expect(ErrorCode.Unauthorized).toBe(-32002);
    expect(ErrorCode.VersionMismatch).toBe(-32003);
    expect(ErrorCode.ToolNotFound).toBe(-32004);
    expect(ErrorCode.ToolTimeout).toBe(-32005);
    expect(ErrorCode.InstanceBusy).toBe(-32006);
    expect(ErrorCode.ConnectionLimitExceeded).toBe(-32009);
  });
});
