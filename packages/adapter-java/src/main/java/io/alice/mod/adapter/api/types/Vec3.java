package io.alice.mod.adapter.api.types;

/**
 * 三维坐标值类型。
 * <p>
 * 不绑定 Minecraft 的 Vec3 类，保持 API 独立性。
 */
public record Vec3(double x, double y, double z) {

    public static Vec3 of(double x, double y, double z) {
        return new Vec3(x, y, z);
    }

    /** 计算与另一个点的欧几里得距离。 */
    public double distanceTo(Vec3 other) {
        double dx = this.x - other.x;
        double dy = this.y - other.y;
        double dz = this.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** 计算水平距离（忽略 Y 轴）。 */
    public double horizontalDistanceTo(Vec3 other) {
        double dx = this.x - other.x;
        double dz = this.z - other.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** 计算向量的长度（模）。 */
    public double length() {
        return Math.sqrt(x * x + y * y + z * z);
    }
}
