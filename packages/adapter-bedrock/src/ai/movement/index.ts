// 移动系统占位

export interface MoveCommand {
  x: number;
  y: number;
  z: number;
  speed?: number;
}

export class MovementSystem {
  async moveTo(target: MoveCommand): Promise<void> {
    // TODO: Execute movement
  }

  async stop(): Promise<void> {
    // TODO: Stop movement
  }
}
