package io.alice.mod.adapter.ai.tracker;

import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * 追踪器管理器。
 * <p>
 * 从 altoclef {@code adris.altoclef.trackers.TrackerManager} 移植。
 * <p>
 * 职责：
 * <ul>
 *   <li>管理所有 Tracker 实例</li>
 *   <li>每 tick 标记所有 Tracker 为 dirty</li>
 *   <li>离开世界时重置所有 Tracker</li>
 * </ul>
 */
public class TrackerManager {

    private static final Logger LOG = LoggerFactory.getLogger(TrackerManager.class);

    private final List<Tracker> trackers = new ArrayList<>();
    private boolean wasInGame = false;

    public TrackerManager() {
    }

    /**
     * 每 tick 由外部驱动调用。
     * <p>
     * 如果离开世界，重置所有 Tracker。
     * 强制所有 Tracker 在下次查询时重新更新。
     *
     * @param bot 假人句柄
     */
    public void tick(BotHandle bot) {
        boolean inGame = bot.getNativePlayer() != null;

        // 离开世界时重置
        if (!inGame && wasInGame) {
            LOG.debug("TrackerManager: leaving world, resetting all trackers");
            for (Tracker tracker : trackers) {
                tracker.reset();
            }
        }
        wasInGame = inGame;

        // 标记所有 Tracker 为 dirty
        for (Tracker tracker : trackers) {
            tracker.setDirty();
        }
    }

    /**
     * 注册一个 Tracker。
     */
    public void addTracker(Tracker tracker) {
        tracker.setBot(bot);
        trackers.add(tracker);
        LOG.debug("TrackerManager: added tracker {}", tracker.getClass().getSimpleName());
    }

    public void setBot(BotHandle bot) {
        this.bot = bot;
        for (Tracker tracker : trackers) {
            tracker.setBot(bot);
        }
    }

    private BotHandle bot;
}