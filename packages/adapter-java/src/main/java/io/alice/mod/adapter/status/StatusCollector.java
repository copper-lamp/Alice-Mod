package io.alice.mod.adapter.status;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * 状态采集与上报管理器。
 * <p>
 * 周期性采集假人状态（每 2 秒），通过回调推送到 TCP 客户端发送。
 * 采集过程在独立线程执行，不影响游戏主线程。
 */
public final class StatusCollector {

    private static final Logger LOG = LoggerFactory.getLogger(StatusCollector.class);

    /** 默认上报间隔（秒） */
    private static final long DEFAULT_INTERVAL_SECONDS = 2;

    private final long intervalSeconds;
    private final Supplier<StatusData> collector;
    private final Consumer<StatusData> reporter;

    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> task;

    /**
     * @param collector 状态采集回调
     * @param reporter  状态上报回调
     */
    public StatusCollector(Supplier<StatusData> collector, Consumer<StatusData> reporter) {
        this(collector, reporter, DEFAULT_INTERVAL_SECONDS);
    }

    /**
     * @param collector       状态采集回调
     * @param reporter        状态上报回调
     * @param intervalSeconds 上报间隔（秒）
     */
    public StatusCollector(Supplier<StatusData> collector, Consumer<StatusData> reporter,
                           long intervalSeconds) {
        this.collector = collector;
        this.reporter = reporter;
        this.intervalSeconds = intervalSeconds;
    }

    /** 启动周期性状态上报。 */
    public synchronized void start() {
        if (scheduler != null && !scheduler.isShutdown()) {
            LOG.warn("StatusCollector already running");
            return;
        }

        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "alice-status-collector");
            t.setDaemon(true);
            return t;
        });

        task = scheduler.scheduleAtFixedRate(this::collectAndReport,
                0, intervalSeconds, TimeUnit.SECONDS);

        LOG.info("StatusCollector started (interval={}s)", intervalSeconds);
    }

    /** 停止状态上报。 */
    public synchronized void stop() {
        if (task != null) {
            task.cancel(false);
            task = null;
        }
        if (scheduler != null) {
            scheduler.shutdown();
            scheduler = null;
        }
        LOG.info("StatusCollector stopped");
    }

    /** 单次采集并上报。 */
    private void collectAndReport() {
        try {
            long start = System.nanoTime();
            StatusData data = collector.get();
            if (data != null) {
                reporter.accept(data);
            }
            long elapsed = (System.nanoTime() - start) / 1_000_000;
            if (elapsed > 5) {
                LOG.debug("Status collection took {}ms (threshold: 5ms)", elapsed);
            }
        } catch (Exception e) {
            LOG.warn("Status collection failed", e);
        }
    }

    /** 是否正在运行。 */
    public boolean isRunning() {
        return task != null && !task.isCancelled();
    }
}
