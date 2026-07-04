// 寻路系统占位

export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

export class PathfindingSystem {
  async findPath(from: PathPoint, to: PathPoint): Promise<PathPoint[]> {
    // TODO: Implement A* or other pathfinding algorithm
    return [from, to];
  }
}
