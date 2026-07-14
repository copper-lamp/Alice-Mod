package io.alice.mod.adapter.api.types;

/**
 * 碰撞形状信息。
 */
public record CollisionShape(
        boolean isEmpty,
        double minX, double minY, double minZ,
        double maxX, double maxY, double maxZ
) {}
