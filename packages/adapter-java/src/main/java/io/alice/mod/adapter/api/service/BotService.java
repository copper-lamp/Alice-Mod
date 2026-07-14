package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.Vec3;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 假人管理服务。
 * <p>
 * 提供假人的生命周期管理和状态查询。
 * 所有方法都假定 {@code nameOrUuid} 参数可以是假人名称或 UUID 字符串。
 */
public interface BotService {

    /** 创建并生成假人。同名假人幂等——已在线返回在线实例，已注册但离线则唤醒。 */
    BotHandle spawn(String name, Vec3 position, String dimension);

    /** 休眠假人（保存存档后移除，不删除注册信息）。 */
    boolean despawn(String nameOrUuid);

    /** 永久销毁假人（下线并删除注册信息）。 */
    boolean dismiss(String nameOrUuid);

    /** 根据 UUID 获取在线假人。 */
    Optional<BotHandle> get(UUID uuid);

    /** 根据名称获取在线假人。 */
    Optional<BotHandle> findByName(String name);

    /** 获取所有在线假人。 */
    List<BotHandle> getAllOnline();

    /** 获取所有已注册假人信息（在线 + 离线）。 */
    List<BotInfo> listAll();

    /** 判断指定 UUID 是否为假人。 */
    boolean isBot(UUID uuid);
}
