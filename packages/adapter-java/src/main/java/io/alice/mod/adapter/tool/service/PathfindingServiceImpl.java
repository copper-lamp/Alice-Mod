package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.service.PathfindingService;
import io.alice.mod.adapter.api.types.PathConstraints;
import io.alice.mod.adapter.api.types.PathResult;
import io.alice.mod.adapter.api.types.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * {@link PathfindingService} 实现。
 * <p>
 * 当前实现简单的直线路径生成——在起点和终点之间均匀插值生成路点。
 * 后续可替换为真正的 A* 3D 寻路（numen 库中的 {@code AStar}）。
 * <p>
 * 路点间隔为 3 格，最后一段直接指向终点。
 */
public class PathfindingServiceImpl implements PathfindingService {

    private static final Logger LOG = LoggerFactory.getLogger(PathfindingServiceImpl.class);

    /** 路点间隔（方块）。 */
    private static final double WAYPOINT_SPACING = 3.0;

    @Override
    public Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension) {
        return findPath(start, goal, dimension, PathConstraints.DEFAULT);
    }

    @Override
    public Optional<PathResult> findPath(Vec3 start, Vec3 goal, String dimension, PathConstraints constraints) {
        long startTime = System.currentTimeMillis();

        // 计算直线距离
        double dx = goal.x() - start.x();
        double dy = goal.y() - start.y();
        double dz = goal.z() - start.z();
        double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // 如果距离很近，直接返回终点作为唯一路点
        if (distance < WAYPOINT_SPACING) {
            List<Vec3> points = new ArrayList<>();
            points.add(goal);
            long elapsed = System.currentTimeMillis() - startTime;
            return Optional.of(new PathResult(points, distance, 1, elapsed));
        }

        // 在直线路径上均匀插值生成路点
        int numSegments = (int) Math.ceil(distance / WAYPOINT_SPACING);
        List<Vec3> points = new ArrayList<>(numSegments + 1);

        for (int i = 1; i <= numSegments; i++) {
            double t = (double) i / numSegments;
            double x = start.x() + dx * t;
            double y = start.y() + dy * t;
            double z = start.z() + dz * t;
            points.add(Vec3.of(x, y, z));
        }

        // 确保最后一个点精确等于目标
        if (!points.isEmpty()) {
            points.set(points.size() - 1, goal);
        }

        long elapsed = System.currentTimeMillis() - startTime;
        LOG.debug("Pathfinding: generated {} waypoints from {} to {} (dist={:.1f}, {}ms)",
                points.size(), start, goal, distance, elapsed);

        return Optional.of(new PathResult(points, distance, points.size(), elapsed));
    }

    @Override
    public boolean isReachable(Vec3 start, Vec3 goal, String dimension) {
        return true; // 直线路径总是可达的
    }
}
