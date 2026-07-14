package io.alice.mod.adapter.api.types;

import java.util.List;

/**
 * 路径计算结果。
 */
public record PathResult(
        List<Vec3> points,
        double totalCost,
        int nodeCount,
        long searchTimeMs
) {}
