package io.alice.mod.adapter.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 配置文件变更监听器。
 * <p>
 * 使用 Java {@link WatchService} 监听 {@code config.json} 文件的修改事件。
 * 延迟 500ms 防抖后触发回调，避免多次修改连续触发。
 * <p>
 * 在独立的守护线程中运行，不影响主模组线程。
 */
public final class ConfigFileWatcher {

    private static final Logger LOG = LoggerFactory.getLogger(ConfigFileWatcher.class);

    /** 防抖延迟（毫秒）。 */
    private static final long DEBOUNCE_MS = 500;

    /** 轮询超时（毫秒）。 */
    private static final long POLL_TIMEOUT_MS = 1000;

    private final Path configFile;
    private final Runnable onChange;
    private final AtomicBoolean running = new AtomicBoolean(false);

    private Thread watchThread;
    private volatile long lastModified = 0;

    /**
     * @param configFile 要监听的配置文件路径
     * @param onChange   文件变更时触发的回调
     */
    public ConfigFileWatcher(Path configFile, Runnable onChange) {
        this.configFile = configFile.toAbsolutePath().normalize();
        this.onChange = onChange;
    }

    /**
     * 启动文件监听。
     * <p>
     * 在独立守护线程中运行，可多次调用（幂等）。
     */
    public void start() {
        if (!running.compareAndSet(false, true)) {
            LOG.debug("ConfigFileWatcher already running");
            return;
        }

        watchThread = new Thread(this::watchLoop, "alice-config-watcher");
        watchThread.setDaemon(true);
        watchThread.start();

        LOG.debug("Config file watcher started: {}", configFile);
    }

    /**
     * 停止文件监听。
     * <p>
     * 中断监听线程，可多次调用（幂等）。
     */
    public void stop() {
        running.set(false);
        if (watchThread != null) {
            watchThread.interrupt();
            try {
                watchThread.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            watchThread = null;
        }
        LOG.debug("Config file watcher stopped");
    }

    /** 监听循环（在独立线程中执行）。 */
    private void watchLoop() {
        try {
            // 确保父目录存在
            Files.createDirectories(configFile.getParent());

            try (WatchService watcher = FileSystems.getDefault().newWatchService()) {
                configFile.getParent().register(watcher,
                        StandardWatchEventKinds.ENTRY_MODIFY,
                        StandardWatchEventKinds.ENTRY_CREATE);

                while (running.get()) {
                    WatchKey key;
                    try {
                        key = watcher.poll(POLL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }

                    if (key == null) {
                        continue;
                    }

                    for (WatchEvent<?> event : key.pollEvents()) {
                        Path changed = (Path) event.context();
                        if (configFile.getFileName().toString().equals(changed.toString())) {
                            handleFileChange();
                        }
                    }

                    if (!key.reset()) {
                        LOG.warn("Watch key invalid, restarting watcher for: {}", configFile);
                        break;
                    }
                }
            }
        } catch (IOException e) {
            if (running.get()) {
                LOG.warn("Config file watcher error, will retry on next start", e);
            }
        }

        LOG.debug("Config file watcher loop ended: {}", configFile);
    }

    /** 处理文件变更事件（带防抖）。 */
    private void handleFileChange() {
        long now = System.currentTimeMillis();
        if (now - lastModified < DEBOUNCE_MS) {
            return; // 防抖：短时间内多次触发只处理一次
        }
        lastModified = now;

        // 延迟执行，等待文件写入完成
        try {
            Thread.sleep(DEBOUNCE_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }

        // 确保文件确实存在
        if (!Files.exists(configFile)) {
            return;
        }

        try {
            onChange.run();
        } catch (Exception e) {
            LOG.warn("Config change callback error", e);
        }
    }
}
