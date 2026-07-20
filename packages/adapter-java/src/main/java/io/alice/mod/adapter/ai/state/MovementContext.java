package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.api.types.Vec3;

/**
 * 移动上下文——记录当前移动所需的全部状态。
 * <p>
 * 由 MovementExecutor 每 tick 更新，供 Task 和 ConditionMonitor 查询。
 */
public class MovementContext {

    // ──────────────────────────────────────────────
    //  路径信息
    // ──────────────────────────────────────────────

    /** 当前路径段索引。 */
    private int segmentIndex = 0;
    /** 当前路径段的目标点。 */
    private Vec3 currentWaypoint = null;
    /** 最终目标点。 */
    private Vec3 finalDestination = null;
    /** 距离最终目标的直线距离。 */
    private double distanceToDestination = Double.MAX_VALUE;

    // ──────────────────────────────────────────────
    //  移动状态
    // ──────────────────────────────────────────────

    /** 当前移动方向（单位向量）。 */
    private Vec3 moveDirection = Vec3.of(0, 0, 0);
    /** 是否正在转向。 */
    private boolean isTurning = false;
    /** 是否希望停止。 */
    private boolean wantStop = false;
    /** 当前移动模式。 */
    private MoveMode moveMode = MoveMode.WALK;

    // ──────────────────────────────────────────────
    //  环境信息（由 ConditionMonitor 更新）
    // ──────────────────────────────────────────────

    /** 是否在水中。 */
    private boolean inWater = false;
    /** 是否在梯子上。 */
    private boolean onLadder = false;
    /** 是否在地面。 */
    private boolean onGround = true;
    /** 是否在熔岩中。 */
    private boolean inLava = false;
    /** 是否着火。 */
    private boolean onFire = false;
    /** 当前饥饿值。 */
    private int foodLevel = 20;
    /** 当前血量。 */
    private float health = 20.0f;
    /** 周围是否有敌对实体。 */
    private boolean hasHostiles = false;

    // ──────────────────────────────────────────────
    //  Getter / Setter
    // ──────────────────────────────────────────────

    public int getSegmentIndex() { return segmentIndex; }
    public void setSegmentIndex(int index) { this.segmentIndex = index; }

    public Vec3 getCurrentWaypoint() { return currentWaypoint; }
    public void setCurrentWaypoint(Vec3 waypoint) { this.currentWaypoint = waypoint; }

    public Vec3 getFinalDestination() { return finalDestination; }
    public void setFinalDestination(Vec3 dest) { this.finalDestination = dest; }

    public double getDistanceToDestination() { return distanceToDestination; }
    public void setDistanceToDestination(double dist) { this.distanceToDestination = dist; }

    public Vec3 getMoveDirection() { return moveDirection; }
    public void setMoveDirection(Vec3 dir) { this.moveDirection = dir; }

    public boolean isTurning() { return isTurning; }
    public void setTurning(boolean turning) { this.isTurning = turning; }

    public boolean isWantStop() { return wantStop; }
    public void setWantStop(boolean stop) { this.wantStop = stop; }

    public MoveMode getMoveMode() { return moveMode; }
    public void setMoveMode(MoveMode mode) { this.moveMode = mode; }

    public boolean isInWater() { return inWater; }
    public void setInWater(boolean inWater) { this.inWater = inWater; }

    public boolean isOnLadder() { return onLadder; }
    public void setOnLadder(boolean onLadder) { this.onLadder = onLadder; }

    public boolean isOnGround() { return onGround; }
    public void setOnGround(boolean onGround) { this.onGround = onGround; }

    public boolean isInLava() { return inLava; }
    public void setInLava(boolean inLava) { this.inLava = inLava; }

    public boolean isOnFire() { return onFire; }
    public void setOnFire(boolean onFire) { this.onFire = onFire; }

    public int getFoodLevel() { return foodLevel; }
    public void setFoodLevel(int foodLevel) { this.foodLevel = foodLevel; }

    public float getHealth() { return health; }
    public void setHealth(float health) { this.health = health; }

    public boolean isHasHostiles() { return hasHostiles; }
    public void setHasHostiles(boolean hasHostiles) { this.hasHostiles = hasHostiles; }

    /**
     * 复位所有状态。
     */
    public void reset() {
        segmentIndex = 0;
        currentWaypoint = null;
        finalDestination = null;
        distanceToDestination = Double.MAX_VALUE;
        moveDirection = Vec3.of(0, 0, 0);
        isTurning = false;
        wantStop = false;
        moveMode = MoveMode.WALK;
        inWater = false;
        onLadder = false;
        onGround = true;
        inLava = false;
        onFire = false;
        foodLevel = 20;
        health = 20.0f;
        hasHostiles = false;
    }
}