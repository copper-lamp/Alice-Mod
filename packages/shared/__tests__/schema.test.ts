import { describe, it, expect } from 'vitest';
import { ToolCategory, type ToolSchema, type ParamDefinition, type ToolResult } from '../src/schema/index.js';

describe('schema', () => {
  describe('ToolCategory', () => {
    it('should have all required categories', () => {
      expect(ToolCategory.Perception).toBe('perception');
      expect(ToolCategory.Movement).toBe('movement');
      expect(ToolCategory.Inventory).toBe('inventory');
      expect(ToolCategory.Entity).toBe('entity');
      expect(ToolCategory.Survival).toBe('survival');
      expect(ToolCategory.Block).toBe('block');
      expect(ToolCategory.Chat).toBe('chat');
      expect(ToolCategory.QQ).toBe('qq');
      expect(ToolCategory.Memory).toBe('memory');
      expect(ToolCategory.Task).toBe('task');
    });
  });

  describe('ParamDefinition', () => {
    it('should allow typed parameter definition', () => {
      const param: ParamDefinition = {
        type: 'string',
        description: 'Target player name',
        required: true,
      };
      expect(param.type).toBe('string');
      expect(param.required).toBe(true);
    });

    it('should allow nested object parameters', () => {
      const param: ParamDefinition = {
        type: 'object',
        properties: {
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
        },
      };
      expect(param.type).toBe('object');
      expect(param.properties?.x.type).toBe('number');
    });

    it('should allow array parameters with items', () => {
      const param: ParamDefinition = {
        type: 'array',
        items: { type: 'string' },
      };
      expect(param.type).toBe('array');
      expect(param.items?.type).toBe('string');
    });
  });

  describe('ToolSchema', () => {
    it('should define a valid tool schema', () => {
      const schema: ToolSchema = {
        name: 'move_to',
        description: 'Move to target coordinates',
        category: ToolCategory.Movement,
        parameters: {
          x: { type: 'number', required: true, description: 'X coordinate' },
          z: { type: 'number', required: true, description: 'Z coordinate' },
        },
        enabled: true,
      };
      expect(schema.name).toBe('move_to');
      expect(schema.category).toBe('movement');
      expect(Object.keys(schema.parameters)).toHaveLength(2);
    });
  });

  describe('ToolResult', () => {
    it('should define a success result', () => {
      const result: ToolResult<{ x: number }> = {
        success: true,
        data: { x: 100 },
        duration: 500,
      };
      expect(result.success).toBe(true);
      expect(result.duration).toBe(500);
    });

    it('should define a failure result with error', () => {
      const result: ToolResult = {
        success: false,
        error: 'Unable to reach target',
        duration: 3000,
      };
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include resource cost information', () => {
      const result: ToolResult = {
        success: true,
        cost: {
          time: 5000,
          hunger: 2,
          durability: 1,
        },
      };
      expect(result.cost?.time).toBe(5000);
      expect(result.cost?.hunger).toBe(2);
      expect(result.cost?.durability).toBe(1);
    });
  });
});
