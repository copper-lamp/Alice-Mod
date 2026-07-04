import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrames, FrameAccumulator, encodeFrames, FRAME_DELIMITER } from '../../src/main/tcp/frame';

describe('Frame (粘包处理)', () => {
  describe('encodeFrame', () => {
    it('should append newline delimiter', () => {
      const buf = encodeFrame('{"jsonrpc":"2.0"}');
      expect(buf.toString()).toBe('{"jsonrpc":"2.0"}\n');
    });
  });

  describe('decodeFrames', () => {
    it('should decode a single complete frame', () => {
      const buffer = Buffer.from('{"id":1}\n');
      const { messages, remaining } = decodeFrames(buffer);
      expect(messages).toEqual(['{"id":1}']);
      expect(remaining.length).toBe(0);
    });

    it('should decode multiple frames from one buffer', () => {
      const buffer = Buffer.from('{"a":1}\n{"b":2}\n');
      const { messages, remaining } = decodeFrames(buffer);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('{"a":1}');
      expect(messages[1]).toBe('{"b":2}');
    });

    it('should handle incomplete frame (remaining)', () => {
      const buffer = Buffer.from('{"partial": true');
      const { messages, remaining } = decodeFrames(buffer);
      expect(messages).toHaveLength(0);
      expect(remaining.toString()).toBe('{"partial": true');
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.alloc(0);
      const { messages, remaining } = decodeFrames(buffer);
      expect(messages).toHaveLength(0);
      expect(remaining.length).toBe(0);
    });
  });

  describe('FrameAccumulator', () => {
    it('should accumulate and extract messages across chunks', () => {
      const acc = new FrameAccumulator();

      // First chunk: partial message
      const msgs1 = acc.feed(Buffer.from('{"msg": 1'));
      expect(msgs1).toHaveLength(0);

      // Second chunk: completes first message + starts second
      const msgs2 = acc.feed(Buffer.from('}\n{"msg": 2'));
      expect(msgs2).toHaveLength(1);
      expect(msgs2[0]).toBe('{"msg": 1}');

      // Third chunk: completes second message
      const msgs3 = acc.feed(Buffer.from('}\n'));
      expect(msgs3).toHaveLength(1);
      expect(msgs3[0]).toBe('{"msg": 2}');
    });

    it('should handle three messages sent at once (粘包测试)', () => {
      const acc = new FrameAccumulator();
      const messages = acc.feed(
        Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n'),
      );
      expect(messages).toHaveLength(3);
      expect(JSON.parse(messages[0]).id).toBe(1);
      expect(JSON.parse(messages[1]).id).toBe(2);
      expect(JSON.parse(messages[2]).id).toBe(3);
    });

    it('should reset buffer', () => {
      const acc = new FrameAccumulator();
      acc.feed(Buffer.from('incomplete'));
      expect(acc.remainingBytes).toBeGreaterThan(0);
      acc.reset();
      expect(acc.remainingBytes).toBe(0);
    });
  });

  describe('encodeFrames', () => {
    it('should encode multiple messages', () => {
      const buf = encodeFrames(['{"a":1}', '{"b":2}']);
      const parts = buf.toString().split(FRAME_DELIMITER).filter(Boolean);
      expect(parts).toEqual(['{"a":1}', '{"b":2}']);
    });
  });
});
