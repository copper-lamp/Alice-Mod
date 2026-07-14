package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.service.PathfindingService;
import io.alice.mod.adapter.api.types.PathConstraints;
import io.alice.mod.adapter.api.types.PathResult;
import io.alice.mod.adapter.api.types.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Optional;

/**
 * {@link PathfindingService} 实现。
 * <p>
 * 当前为桩实现（stub），实际的 A* 3D 寻路算法将在 V4 阶段实现。
 * 返回空结果，提醒开发者寻路系统尚在建设中。
 */
public class PathfindingServiceImpl implements PathfindingService {

    private static final Logger LOG = LoggerFactory.getLogger(PathfindingServiceImpl.class);

    @Override
    public Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension) {
        return findPath(start, goal, dimension, PathConstraints.DEFAULT);
    }

    @Override
    public Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension, PathConstraints constraints) {
        LOG.warn("PathfindingService.findPath() is not yet implemented (stub). " +
                "A* 3D pathfinding is planned for V4 development phase.");
        return Optional.empty();
    }

    @Override
    public boolean isReachable(Vec3 start, Vec3 goal, String dimension) {
        return findPath(start, goal, dimension).isPresent();
    }
}
