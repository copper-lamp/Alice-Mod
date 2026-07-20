package io.alice.mod.adapter.ai.action;

import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 动作控制器——Carpet ActionPack 的封装层。
 * <p>
 * 参考 BE {@code adapter-bedrock/src/ai/movement/action-controller.ts} 实现。
 * <p>
 * 职责：
 * <ul>
 *   <li>封装 Carpet 假人动作 API（EntityPlayerActionPack）</li>
 *   <li>提供高级动作接口供 Task 和 MovementExecutor 调用</li>
 *   <li>管理动作状态（开始、持续、停止）</li>
 * </ul>
 * <p>
 * 注意：所有动作应通过此控制器统一管理，不直接操作输入。
 */
public class ActionController {

    private static final Logger LOG = LoggerFactory.getLogger(ActionController.class);

    private boolean moving = false;
    private boolean sprinting = false;
    private boolean attacking = false;
    private boolean usingItem = false;
    private boolean jumping = false;

    // ──────────────────────────────────────────────
    //  移动控制
    // ──────────────────────────────────────────────

    /**
     * 开始向目标位置移动。
     * 使用 Carpet ActionPack 的 movement 能力。
     *
     * @param bot    假人句柄
     * @param target 目标位置
     * @param speed  移动速度倍率（0.0 ~ 1.0）
     */
    public void moveTo(BotHandle bot, Vec3 target, double speed) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return;

        // 使用 Carpet ActionPack 的 moveTo 能力
        // 格式: /player <name> moveTo <x> <y> <z> <speed>
        String command = String.format("player %s moveTo %.2f %.2f %.2f %.2f",
                bot.name(), target.x(), target.y(), target.z(), speed);
        executeCommand(command);
        moving = true;
    }

    /**
     * 停止移动。
     */
    public void stopMoving(BotHandle bot) {
        if (!moving) return;
        String command = String.format("player %s stop", bot.name());
        executeCommand(command);
        moving = false;
    }

    /**
     * 设置疾跑状态。
     *
     * @param bot     假人句柄
     * @param sprint  是否疾跑
     */
    public void setSprint(BotHandle bot, boolean sprint) {
        if (sprint == sprinting) return;
        String command = String.format("player %s %s", bot.name(), sprint ? "sprint" : "stop");
        executeCommand(command);
        sprinting = sprint;
    }

    /**
     * 跳跃。
     */
    public void jump(BotHandle bot) {
        String command = String.format("player %s jump", bot.name());
        executeCommand(command);
        jumping = true;
    }

    /**
     * 停止跳跃。
     */
    public void stopJump(BotHandle bot) {
        if (!jumping) return;
        jumping = false;
    }

    // ──────────────────────────────────────────────
    //  视角控制
    // ──────────────────────────────────────────────

    /**
     * 看向目标位置。
     *
     * @param bot    假人句柄
     * @param target 目标位置
     */
    public void lookAt(BotHandle bot, Vec3 target) {
        String command = String.format("player %s lookAt %.2f %.2f %.2f",
                bot.name(), target.x(), target.y(), target.z());
        executeCommand(command);
    }

    /**
     * 设置视角朝向（yaw/pitch）。
     */
    public void setRotation(BotHandle bot, float yaw, float pitch) {
        String command = String.format("player %s look %.2f %.2f",
                bot.name(), yaw, pitch);
        executeCommand(command);
    }

    // ──────────────────────────────────────────────
    //  交互控制
    // ──────────────────────────────────────────────

    /**
     * 攻击实体。
     */
    public void attack(BotHandle bot) {
        String command = String.format("player %s attack", bot.name());
        executeCommand(command);
        attacking = true;
    }

    /**
     * 停止攻击。
     */
    public void stopAttack(BotHandle bot) {
        if (!attacking) return;
        attacking = false;
    }

    /**
     * 使用物品（右键）。
     */
    public void useItem(BotHandle bot) {
        String command = String.format("player %s useItem", bot.name());
        executeCommand(command);
        usingItem = true;
    }

    /**
     * 停止使用物品。
     */
    public void stopUseItem(BotHandle bot) {
        if (!usingItem) return;
        usingItem = false;
    }

    // ──────────────────────────────────────────────
    //  方块操作
    // ──────────────────────────────────────────────

    /**
     * 破坏方块。
     *
     * @param bot 假人句柄
     * @param x   方块 X 坐标
     * @param y   方块 Y 坐标
     * @param z   方块 Z 坐标
     */
    public void breakBlock(BotHandle bot, int x, int y, int z) {
        String command = String.format("player %s breakBlock %d %d %d",
                bot.name(), x, y, z);
        executeCommand(command);
    }

    /**
     * 放置方块。
     *
     * @param bot 假人句柄
     * @param x   目标位置 X
     * @param y   目标位置 Y
     * @param z   目标位置 Z
     */
    public void placeBlock(BotHandle bot, int x, int y, int z) {
        String command = String.format("player %s placeBlock %d %d %d",
                bot.name(), x, y, z);
        executeCommand(command);
    }

    // ──────────────────────────────────────────────
    //  停止所有动作
    // ──────────────────────────────────────────────

    /**
     * 停止所有正在执行的动作。
     */
    public void stopAll(BotHandle bot) {
        String command = String.format("player %s stop", bot.name());
        executeCommand(command);
        moving = false;
        sprinting = false;
        attacking = false;
        usingItem = false;
        jumping = false;
        LOG.debug("Stopped all actions for bot {}", bot.name());
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void executeCommand(String command) {
        // 通过 Minecraft 服务器执行命令
        net.minecraft.server.MinecraftServer server = getServer();
        if (server != null) {
            server.getCommands().performPrefixedCommand(
                    server.createCommandSourceStack(), command);
        }
    }

    private net.minecraft.server.MinecraftServer getServer() {
        // 通过 Fabric API 或模组入口获取服务器实例
        // 实际实现需根据 AliceModServer 的入口类调整
        return null; // TODO: 注入服务器实例
    }
}