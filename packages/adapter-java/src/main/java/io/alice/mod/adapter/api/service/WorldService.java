package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.CollisionShape;
import io.alice.mod.adapter.api.types.EntityInfo;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.api.types.WeatherInfo;

import java.util.List;
import java.util.Map;

/**
 * 游戏世界服务。
 * <p>
 * 提供对 Minecraft 游戏世界的查询能力。
 */
public interface WorldService {

    /** 获取指定位置的方块 ID（如 "minecraft:stone"）。 */
    String getBlockId(int x, int y, int z, String dimension);

    /** 获取指定位置的方块状态属性。 */
    Map<String, String> getBlockProperties(int x, int y, int z, String dimension);

    /** 检查指定位置是否为空气。 */
    boolean isAir(int x, int y, int z, String dimension);

    /** 获取指定位置的碰撞形状（用于寻路）。 */
    CollisionShape getCollisionShape(int x, int y, int z, String dimension);

    /** 获取指定维度内所有附近的实体。 */
    List<EntityInfo> getNearbyEntities(Vec3 center, double radius, String dimension);

    /** 获取游戏时间（游戏刻）。 */
    long getGameTime(String dimension);

    /** 获取天气状态。 */
    WeatherInfo getWeather(String dimension);

    /** 获取所有可用维度列表。 */
    List<String> getDimensions();
}
