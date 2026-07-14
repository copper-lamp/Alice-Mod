package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.PathConstraints;
import io.alice.mod.adapter.api.types.PathResult;
import io.alice.mod.adapter.api.types.Vec3;

import java.util.Optional;

/**
 * 寻路服务。
 * <p>
 * 提供基于 A* 3D 算法的路径计算能力。
 */
public interface PathfindingService {

    /** 计算两点之间的路径。 */
    Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension);

    /** 计算带约束的路径。 */
    Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension, PathConstraints constraints);

    /** 检查目标位置是否可达。 */
    boolean isReachable(Vec3 start, Vec3 goal, String dimension);
}
