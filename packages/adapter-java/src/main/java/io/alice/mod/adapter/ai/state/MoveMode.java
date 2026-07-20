package io.alice.mod.adapter.ai.state;

/**
 * 移动模式枚举。
 * <p>
 * 定义假人所有可能的移动/动作状态。
 * 状态机基于当前环境和目标自动选择最合适的模式。
 */
public enum MoveMode {
    /** 行走（默认状态）。 */
    WALK,
    /** 疾跑。 */
    SPRINT,
    /** 疾跑跳跃（跑酷、跨越间隙）。 */
    SPRINT_JUMP,
    /** 游泳（水中/水面）。 */
    SWIM,
    /** 攀爬（梯子、藤蔓、脚手架）。 */
    CLIMB,
    /** 鞘翅滑翔。 */
    ELYTRA,
    /** 骑乘实体。 */
    RIDE,
    /** 乘船。 */
    BOAT,
    /** 破坏方块。完成后回到前一个状态。 */
    BREAK_BLOCK,
    /** 放置方块。完成后回到前一个状态。 */
    PLACE_BLOCK
}