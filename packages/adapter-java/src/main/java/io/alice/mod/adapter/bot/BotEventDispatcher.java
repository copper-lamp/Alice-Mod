package io.alice.mod.adapter.bot;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;

/**
 * 假人生命周期事件分发器。
 * <p>
 * 工具执行层通过注册监听器来感知假人的状态变化（生成、销毁、死亡等）。
 * 采用 {@link CopyOnWriteArrayList} 保证线程安全，适合读多写少的场景。
 * <p>
 * 事件类型：
 * <ul>
 *   <li>{@link #ON_SPAWN} — 假人成功生成到游戏世界</li>
 *   <li>{@link #ON_DESPAWN} — 假人下线（休眠）</li>
 *   <li>{@link #ON_DEATH} — 假人死亡</li>
 *   <li>{@link #ON_DISMISS} — 假人永久销毁</li>
 *   <li>{@link #ON_RESPAWN} — 假人死亡后重生</li>
 * </ul>
 */
public final class BotEventDispatcher {

    private static final Logger LOG = LoggerFactory.getLogger(BotEventDispatcher.class);

    /** 假人生成。参数：(botName, botUuid) */
    public static final List<BiConsumer<String, UUID>> ON_SPAWN = new CopyOnWriteArrayList<>();

    /** 假人下线。参数：(botName, botUuid) */
    public static final List<BiConsumer<String, UUID>> ON_DESPAWN = new CopyOnWriteArrayList<>();

    /** 假人死亡。参数：(botName, botUuid, deathMessage) */
    public static final List<TriConsumer<String, UUID, String>> ON_DEATH = new CopyOnWriteArrayList<>();

    /** 假人永久销毁。参数：(botName, botUuid) */
    public static final List<BiConsumer<String, UUID>> ON_DISMISS = new CopyOnWriteArrayList<>();

    /** 假人重生。参数：(botName, botUuid) */
    public static final List<BiConsumer<String, UUID>> ON_RESPAWN = new CopyOnWriteArrayList<>();

    private BotEventDispatcher() {}

    // ---- 触发方法 ---- //

    /** 触发假人生成事件。 */
    static void fireSpawn(String name, UUID uuid) {
        for (var listener : ON_SPAWN) {
            try {
                listener.accept(name, uuid);
            } catch (Exception e) {
                LOG.warn("BotEventDispatcher: ON_SPAWN listener failed", e);
            }
        }
    }

    /** 触发假人下线事件。 */
    static void fireDespawn(String name, UUID uuid) {
        for (var listener : ON_DESPAWN) {
            try {
                listener.accept(name, uuid);
            } catch (Exception e) {
                LOG.warn("BotEventDispatcher: ON_DESPAWN listener failed", e);
            }
        }
    }

    /** 触发假人死亡事件。 */
    static void fireDeath(String name, UUID uuid, String deathMessage) {
        for (var listener : ON_DEATH) {
            try {
                listener.accept(name, uuid, deathMessage);
            } catch (Exception e) {
                LOG.warn("BotEventDispatcher: ON_DEATH listener failed", e);
            }
        }
    }

    /** 触发假人销毁事件。 */
    static void fireDismiss(String name, UUID uuid) {
        for (var listener : ON_DISMISS) {
            try {
                listener.accept(name, uuid);
            } catch (Exception e) {
                LOG.warn("BotEventDispatcher: ON_DISMISS listener failed", e);
            }
        }
    }

    /** 触发假人重生事件。 */
    static void fireRespawn(String name, UUID uuid) {
        for (var listener : ON_RESPAWN) {
            try {
                listener.accept(name, uuid);
            } catch (Exception e) {
                LOG.warn("BotEventDispatcher: ON_RESPAWN listener failed", e);
            }
        }
    }

    // ---- 三元消费者接口 ---- //

    @FunctionalInterface
    public interface TriConsumer<A, B, C> {
        void accept(A a, B b, C c);
    }
}