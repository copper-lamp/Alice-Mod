package io.alice.mod.adapter.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;

/**
 * 路径迁移工具 — 将旧数据目录 {@code config/mcagent/} 迁移到 {@code Alice/}。
 * <p>
 * 首次启动 V12 版本时检测旧路径，自动复制数据到新路径。
 * 迁移只复制不删除旧文件，保证回滚安全。
 * <p>
 * 迁移完成后在旧目录创建 {@code .migrated_to_alice} 标记文件，防止重复迁移。
 */
public final class PathMigration {

    private static final Logger LOG = LoggerFactory.getLogger(PathMigration.class);

    /** 迁移完成标记文件名。 */
    private static final String MIGRATED_MARKER = ".migrated_to_alice";

    private PathMigration() {}

    /**
     * 执行路径迁移（如果旧路径存在且未迁移过）。
     *
     * @param gameDir 游戏根目录
     * @return true 表示执行了迁移，false 表示无需迁移
     */
    public static boolean migrateIfNeeded(Path gameDir) {
        Path oldDir = AlicePaths.oldConfigDir(gameDir);
        Path newDir = AlicePaths.aliceDir(gameDir);
        Path marker = oldDir.resolve(MIGRATED_MARKER);

        // 旧路径不存在，无需迁移
        if (!Files.exists(oldDir)) {
            return false;
        }

        // 已迁移过（有标记文件），跳过
        if (Files.exists(marker)) {
            return false;
        }

        // 新路径已存在且有内容，跳过迁移
        if (Files.exists(newDir)) {
            try (var files = Files.list(newDir)) {
                if (files.findAny().isPresent()) {
                    LOG.info("New Alice directory already exists with content, skipping migration");
                    // 仍然创建标记，防止下次检查
                    Files.createDirectories(oldDir);
                    Files.writeString(marker, "skipped_at=" + Instant.now()
                            + "\nreason=New Alice directory already exists");
                    return false;
                }
            } catch (IOException e) {
                LOG.warn("Failed to check new directory content", e);
            }
        }

        try {
            doMigrate(oldDir, newDir, marker);
            LOG.info("Path migration completed: config/mcagent/ -> Alice/");
            return true;
        } catch (IOException e) {
            LOG.error("Path migration failed", e);
            return false;
        }
    }

    /**
     * 执行实际迁移操作。
     * <p>
     * 使用 Files.walk 递归遍历旧目录，将每个文件/目录复制到新路径。
     * 迁移后创建标记文件。
     */
    private static void doMigrate(Path oldDir, Path newDir, Path marker) throws IOException {
        // 确保新目录存在
        Files.createDirectories(newDir);

        // 递归复制旧目录内容到新目录
        try (var stream = Files.walk(oldDir)) {
            var iter = stream.iterator();
            while (iter.hasNext()) {
                Path oldPath = iter.next();
                // 跳过标记文件自身（尚未创建）
                if (oldPath.equals(marker)) {
                    continue;
                }
                Path relative = oldDir.relativize(oldPath);
                Path newPath = newDir.resolve(relative);
                Files.copy(oldPath, newPath, StandardCopyOption.REPLACE_EXISTING);
            }
        }

        // 创建迁移标记
        Files.writeString(marker, "migrated_at=" + Instant.now() + "\n");
        LOG.info("Migration marker created: {}", marker);
    }
}
