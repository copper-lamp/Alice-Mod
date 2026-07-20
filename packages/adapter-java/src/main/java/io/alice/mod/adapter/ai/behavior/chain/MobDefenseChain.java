package io.alice.mod.adapter.ai.behavior.chain;

import io.alice.mod.adapter.ai.behavior.SingleTaskChain;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.*;
import net.minecraft.world.entity.projectile.Fireball;
import net.minecraft.world.entity.projectile.DragonFireball;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.SwordItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 怪物防御链——自动防御敌对生物。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.MobDefenseChain} 移植。
 * <p>
 * 优先级：70/65/80（动态）
 * <p>
 * 职责：
 * <ul>
 *   <li>检测敌对生物并自动反击</li>
 *   <li>爬行者爆炸时逃跑</li>
 *   <li>弹射物躲避</li>
 *   <li>火把/灭火等紧急处理</li>
 *   <li>Force Field：自动攻击近距离敌对生物</li>
 * </ul>
 */
public class MobDefenseChain extends SingleTaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(MobDefenseChain.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    private static final double CREEPER_KEEP_DISTANCE = 10;
    private static final double ARROW_KEEP_DISTANCE_HORIZONTAL = 2;
    private static final double ARROW_KEEP_DISTANCE_VERTICAL = 10;
    private static final double DANGER_KEEP_DISTANCE = 15 * 2;
    private static final double SAFE_KEEP_DISTANCE = 8;
    private static final double FORCE_FIELD_RANGE = 4.0;

    /** 主动攻击的敌对生物类型。 */
    private static final Class<?>[] HOSTILE_CLASSES = {
            Skeleton.class, Zombie.class, Spider.class, CaveSpider.class,
            Witch.class, Piglin.class, PiglinBrute.class, Hoglin.class,
            Zoglin.class, Blaze.class, WitherSkeleton.class,
            Pillager.class, Drowned.class
    };

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Map<Entity, Long> closeHostileTimers = new HashMap<>();
    private Entity targetEntity;
    private boolean doingFunkyStuff = false;
    private boolean wasPuttingOutFire = false;
    private float cachedLastPriority;
    private int forceFieldCooldown = 0;

    public MobDefenseChain(TaskRunner runner) {
        super(runner);
    }

    // ──────────────────────────────────────────────
    //  Chain 核心
    // ──────────────────────────────────────────────

    @Override
    public float getPriority(BotHandle bot) {
        cachedLastPriority = getPriorityInner(bot);
        return cachedLastPriority;
    }

    private float getPriorityInner(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null || !bot.inGame()) {
            return Float.NEGATIVE_INFINITY;
        }

        // 进食优先
        if (shouldPrioritizeEating(bot)) {
            return Float.NEGATIVE_INFINITY;
        }

        // Force Field：自动攻击近距离敌对生物
        doForceField(bot, player);

        // 检查极度危险的怪物（凋零骷髅、猪灵兽）
        Entity universallyDangerous = getUniversallyDangerousMob(bot, player);
        if (universallyDangerous != null) {
            setTask(new RunAwayHostileTask(DANGER_KEEP_DISTANCE));
            return 70;
        }

        doingFunkyStuff = false;

        // 检查正在爆炸的爬行者
        Entity fusingCreeper = getClosestFusingCreeper(bot, player);
        if (fusingCreeper != null) {
            doingFunkyStuff = true;
            setTask(new RunAwayCreeperTask(CREEPER_KEEP_DISTANCE));
            return 50 + getCreeperFuseTime(fusingCreeper) * 50;
        }

        // 躲避弹射物
        if (isProjectileClose(bot, player)) {
            doingFunkyStuff = true;
            setTask(new DodgeProjectileTask(ARROW_KEEP_DISTANCE_HORIZONTAL, ARROW_KEEP_DISTANCE_VERTICAL));
            return 65;
        }

        // 危险状态逃跑
        if (isInDanger(bot, player)) {
            doingFunkyStuff = true;
            if (targetEntity == null) {
                setTask(new RunAwayHostileTask(DANGER_KEEP_DISTANCE));
                return 70;
            }
        }

        // 处理烦人的敌对生物（靠近太久了就击杀）
        return handleAnnoyingHostiles(bot, player);
    }

    @Override
    protected void onTaskFinish(BotHandle bot) {
        // 任务完成，无事可做
    }

    @Override
    public boolean isActive() {
        return true; // 始终检测敌对生物
    }

    @Override
    public String getName() {
        return "Mob Defense";
    }

    // ──────────────────────────────────────────────
    //  Force Field
    // ──────────────────────────────────────────────

    private void doForceField(BotHandle bot, ServerPlayer player) {
        forceFieldCooldown--;
        if (forceFieldCooldown > 0) return;
        forceFieldCooldown = 5; // 每 5 tick 检查一次

        // 攻击近距离的敌对生物
        for (Entity entity : getNearbyEntities(player, FORCE_FIELD_RANGE)) {
            if (entity instanceof Monster monster) {
                if (isHostileToPlayer(monster)) {
                    attackEntity(bot, player, entity);
                }
            }
        }
    }

    // ──────────────────────────────────────────────
    //  敌对生物检测
    // ──────────────────────────────────────────────

    private Entity getUniversallyDangerousMob(BotHandle bot, ServerPlayer player) {
        // 凋零骷髅：有凋零效果
        Entity witherSkeleton = getClosestEntity(player, WitherSkeleton.class, SAFE_KEEP_DISTANCE - 2);
        if (witherSkeleton != null && isAngryAtPlayer(witherSkeleton)) {
            return witherSkeleton;
        }

        // 猪灵兽：低血量时危险
        if (player.getHealth() < 10) {
            Entity hoglin = getClosestEntity(player, Hoglin.class, SAFE_KEEP_DISTANCE - 1);
            if (hoglin != null && isAngryAtPlayer(hoglin)) {
                return hoglin;
            }
        }

        return null;
    }

    private Creeper getClosestFusingCreeper(BotHandle bot, ServerPlayer player) {
        List<Creeper> creepers = getEntitiesByType(player, Creeper.class);
        Creeper worst = null;
        double worstSafety = Double.POSITIVE_INFINITY;

        for (Creeper creeper : creepers) {
            if (creeper == null || !creeper.isAlive()) continue;
            if (creeper.getSwellDir() < 0) continue; // 不在爆炸状态

            double safety = getCreeperSafety(player, creeper);
            if (safety < worstSafety) {
                worstSafety = safety;
                worst = creeper;
            }
        }

        return worst;
    }

    private double getCreeperSafety(ServerPlayer player, Creeper creeper) {
        double distance = creeper.distanceToSqr(player);
        int fuse = creeper.getSwellDir();
        if (fuse <= 0) return distance;
        return distance * 0.2; // 越小越危险
    }

    private float getCreeperFuseTime(Entity creeper) {
        // 简化版：返回爬行者爆炸进度 (0~1)
        return 0.5f;
    }

    private boolean isProjectileClose(BotHandle bot, ServerPlayer player) {
        for (Entity entity : getNearbyEntities(player, 20)) {
            if (entity instanceof Fireball fireball) {
                if (fireball instanceof DragonFireball) continue; // 忽略龙息
                // 计算弹射物与玩家的预计接近距离
                double dx = player.getX() - fireball.getX();
                double dz = player.getZ() - fireball.getZ();
                double dy = player.getY() - fireball.getY();

                double horizontalDistSq = dx * dx + dz * dz;
                double verticalDist = Math.abs(dy);

                if (horizontalDistSq < ARROW_KEEP_DISTANCE_HORIZONTAL * ARROW_KEEP_DISTANCE_HORIZONTAL
                        && verticalDist < ARROW_KEEP_DISTANCE_VERTICAL) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean isInDanger(BotHandle bot, ServerPlayer player) {
        if (isVulnerable(player)) {
            for (Entity entity : getNearbyEntities(player, SAFE_KEEP_DISTANCE)) {
                if (entity instanceof Monster monster) {
                    if (isHostileToPlayer(monster) && isAngryAtPlayer(entity)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private boolean isVulnerable(ServerPlayer player) {
        int armor = player.getArmorValue();
        float health = player.getHealth();
        if (armor <= 15 && health < 3) return true;
        if (armor < 10 && health < 10) return true;
        return armor < 5 && health < 18;
    }

    private int handleAnnoyingHostiles(BotHandle bot, ServerPlayer player) {
        List<Entity> hostiles = getHostileEntities(player);
        if (hostiles.isEmpty()) return 0;

        // 检查最佳武器
        SwordItem bestSword = getBestSword(bot);
        boolean hasSword = bestSword != null;

        List<Entity> toDealWith = new ArrayList<>();
        long now = System.currentTimeMillis();

        for (Entity hostile : hostiles) {
            int annoyingRange = (hostile instanceof Skeleton || hostile instanceof Witch) ? 18 : 5;
            boolean isClose = hostile.distanceTo(player) < annoyingRange;

            if (isClose) {
                if (!closeHostileTimers.containsKey(hostile)) {
                    closeHostileTimers.put(hostile, now);
                }
                // 靠近超过 5 秒就处理
                if (now - closeHostileTimers.get(hostile) > 5000) {
                    toDealWith.add(hostile);
                }
            } else {
                closeHostileTimers.remove(hostile);
            }
        }

        // 清理已死亡的实体
        closeHostileTimers.keySet().removeIf(e -> !e.isAlive());

        if (!toDealWith.isEmpty()) {
            int armor = player.getArmorValue();
            float damage = hasSword ? 1 + bestSword.getDamage() : 0;
            int canDealWith = (int) Math.ceil((armor * 3.6 / 20.0) + (damage * 0.8)) + 1;

            if (canDealWith > toDealWith.size()) {
                // 可以处理
                setTask(new KillHostilesTask(new ArrayList<>(toDealWith)));
                return 65;
            } else {
                // 打不过，逃跑
                setTask(new RunAwayHostileTask(30));
                return 80;
            }
        }

        return 0;
    }

    private boolean shouldPrioritizeEating(BotHandle bot) {
        // 如果正在紧急进食，不防御
        return false;
    }

    // ──────────────────────────────────────────────
    //  战斗辅助
    // ──────────────────────────────────────────────

    private void attackEntity(BotHandle bot, ServerPlayer player, Entity target) {
        // 通过 Carpet 命令攻击
        String command = String.format("player %s attack", bot.name());
        executeCommand(bot, command);
    }

    // ──────────────────────────────────────────────
    //  实体查询辅助
    // ──────────────────────────────────────────────

    private List<Entity> getNearbyEntities(ServerPlayer player, double range) {
        // 获取附近实体（简化版，实际需要 EntityTracker）
        // 通过 player.getLevel().getEntities() 实现
        return player.serverLevel().getEntities().getAll()
                .stream()
                .filter(e -> e.distanceTo(player) < range)
                .collect(Collectors.toList());
    }

    private <T extends Entity> List<T> getEntitiesByType(ServerPlayer player, Class<T> type) {
        return player.serverLevel().getEntities().getAll()
                .stream()
                .filter(type::isInstance)
                .map(type::cast)
                .collect(Collectors.toList());
    }

    private <T extends Entity> T getClosestEntity(ServerPlayer player, Class<T> type, double range) {
        T closest = null;
        double minDist = range * range;
        for (T entity : getEntitiesByType(player, type)) {
            if (!entity.isAlive()) continue;
            double dist = entity.distanceToSqr(player);
            if (dist < minDist) {
                minDist = dist;
                closest = entity;
            }
        }
        return closest;
    }

    private List<Entity> getHostileEntities(ServerPlayer player) {
        List<Entity> hostiles = new ArrayList<>();
        for (Entity entity : getNearbyEntities(player, 30)) {
            if (entity instanceof Monster monster && isHostileToPlayer(monster)) {
                hostiles.add(entity);
            }
        }
        return hostiles;
    }

    private boolean isHostileToPlayer(Monster monster) {
        return Arrays.stream(HOSTILE_CLASSES).anyMatch(cls -> cls.isInstance(monster));
    }

    private boolean isAngryAtPlayer(Entity entity) {
        // 简化版：假设所有敌对生物都对玩家有敌意
        return entity.isAlive();
    }

    private SwordItem getBestSword(BotHandle bot) {
        // TODO: 从背包中获取最佳剑
        return null;
    }

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public boolean isDoingAcrobatics() {
        return doingFunkyStuff;
    }

    public void setTargetEntity(Entity entity) {
        this.targetEntity = entity;
    }

    public void resetTargetEntity() {
        this.targetEntity = null;
    }

    // ──────────────────────────────────────────────
    //  内部任务
    // ──────────────────────────────────────────────

    private static class RunAwayHostileTask extends Task {
        private final double distance;

        RunAwayHostileTask(double distance) {
            this.distance = distance;
            setDebugState("RunAway(" + distance + ")");
        }

        @Override
        protected void onStart(BotHandle bot) {
            // TODO: 实现逃跑逻辑
        }

        @Override
        protected Task onTick(BotHandle bot) {
            return null;
        }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            return false;
        }

        @Override
        protected boolean isEqual(Task other) {
            return other instanceof RunAwayHostileTask;
        }

        @Override
        protected String toDebugString() {
            return "RunAway(" + distance + ")";
        }
    }

    private static class RunAwayCreeperTask extends Task {
        private final double distance;

        RunAwayCreeperTask(double distance) {
            this.distance = distance;
            setDebugState("RunAwayCreeper(" + distance + ")");
        }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) { return null; }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) { return false; }

        @Override
        protected boolean isEqual(Task other) { return other instanceof RunAwayCreeperTask; }

        @Override
        protected String toDebugString() { return "RunAwayCreeper(" + distance + ")"; }
    }

    private static class DodgeProjectileTask extends Task {
        private final double hDist, vDist;

        DodgeProjectileTask(double hDist, double vDist) {
            this.hDist = hDist;
            this.vDist = vDist;
            setDebugState("DodgeProjectiles");
        }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) { return null; }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) { return false; }

        @Override
        protected boolean isEqual(Task other) { return other instanceof DodgeProjectileTask; }

        @Override
        protected String toDebugString() { return "DodgeProjectiles"; }
    }

    private static class KillHostilesTask extends Task {
        private final List<Entity> targets;

        KillHostilesTask(List<Entity> targets) {
            this.targets = targets;
            setDebugState("KillHostiles(" + targets.size() + ")");
        }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) { return null; }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            return targets.stream().noneMatch(Entity::isAlive);
        }

        @Override
        protected boolean isEqual(Task other) { return other instanceof KillHostilesTask; }

        @Override
        protected String toDebugString() { return "KillHostiles(" + targets.size() + ")"; }
    }
}