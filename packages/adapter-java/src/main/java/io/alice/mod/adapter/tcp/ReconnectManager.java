package io.alice.mod.adapter.tcp;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 断线重连管理器。
 * <p>
 * 采用指数退避策略：1s → 2s → 4s → 8s → 16s，最多 5 次。
 * 每次重连尝试调用 {@link ReconnectHandler} 回调。
 */
public final class ReconnectManager {

    private static final Logger LOG = LoggerFactory.getLogger(ReconnectManager.class);

    /** 固定重连间隔（秒） */
    private static final long DELAY_SECONDS = 2;

    /** 最大重连次数 */
    public static final int MAX_ATTEMPTS = 5;

    private final ScheduledExecutorService scheduler;
    private final ReconnectHandler handler;

    private final AtomicBoolean active = new AtomicBoolean(false);
    private final AtomicInteger attemptCount = new AtomicInteger(0);

    private volatile ScheduledFuture<?> currentTask;

    /**
     * @param scheduler 调度器（应与 TcpClient 共用）
     * @param handler   重连回调
     */
    public ReconnectManager(ScheduledExecutorService scheduler, ReconnectHandler handler) {
        this.scheduler = scheduler;
        this.handler = handler;
    }

    /** 启动重连。从上一次尝试次数继续。 */
    public void start() {
        active.set(true);
        scheduleNext();
    }

    /** 重置并启动重连（从第 1 次开始）。 */
    public void startFresh() {
        attemptCount.set(0);
        start();
    }

    /** 停止重连。 */
    public void stop() {
        active.set(false);
        if (currentTask != null) {
            currentTask.cancel(false);
            currentTask = null;
        }
        LOG.debug("Reconnect stopped after {} attempt(s)", attemptCount.get());
    }

    /** 重置尝试计数（重连成功后调用）。 */
    public void resetAttempts() {
        attemptCount.set(0);
    }

    /** 当前是否为重连中。 */
    public boolean isReconnecting() {
        return active.get() && attemptCount.get() > 0;
    }

    /** 当前尝试次数。 */
    public int getAttemptCount() {
        return attemptCount.get();
    }

    /** 是否还有剩余重连次数。 */
    public boolean hasRemainingAttempts() {
        return attemptCount.get() < MAX_ATTEMPTS;
    }

    private void scheduleNext() {
        if (!active.get()) {
            return;
        }

        int attempt = attemptCount.incrementAndGet();
        if (attempt > MAX_ATTEMPTS) {
            LOG.debug("Reconnect failed after {} attempts, giving up", MAX_ATTEMPTS);
            active.set(false);
            handler.onGiveUp();
            return;
        }

        long delay = DELAY_SECONDS;

        currentTask = scheduler.schedule(() -> {
            if (!active.get()) {
                return;
            }
            try {
                boolean success = handler.onReconnect(attempt);
                if (success) {
                    LOG.debug("Reconnect attempt {} successful", attempt);
                    resetAttempts();
                    active.set(false);
                } else {
                    scheduleNext();
                }
            } catch (Exception e) {
                LOG.debug("Reconnect attempt {} failed with exception", attempt);
                scheduleNext();
            }
        }, delay, TimeUnit.SECONDS);
    }

    

    /**
     * 重连处理器回调。
     */
    @FunctionalInterface
    public interface ReconnectHandler {
        /**
         * 执行一次重连尝试。
         *
         * @param attemptNumber 当前是第几次重连（1-based）
         * @return true 表示重连成功，false 表示继续下一次
         */
        boolean onReconnect(int attemptNumber);

        /**
         * 所有重连尝试均失败时调用。
         * <p>
         * 默认实现为空。
         */
        default void onGiveUp() {
            LOG.debug("All {} reconnect attempts exhausted", MAX_ATTEMPTS);
        }
    }
}
