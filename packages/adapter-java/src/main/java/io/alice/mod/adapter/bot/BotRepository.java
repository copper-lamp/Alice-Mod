package io.alice.mod.adapter.bot;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.UUIDUtil;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.SavedData;
import org.jetbrains.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 假人注册表持久化 — 基于 Minecraft {@link SavedData} 机制。
 * <p>
 * 假人的身躯数据（背包、血量、位置等）由 {@code .dat} 存档自动管理。
 * 本注册表保存的是假人的索引信息：名称、UUID、最后所在维度、最后位置、创建时间。
 * 用于在服务端重启后恢复假人列表。
 * <p>
 * 数据保存在主世界的存档中（一个文件，包含所有假人条目）。
 */
public final class BotRepository extends SavedData {

    private static final Logger LOG = LoggerFactory.getLogger(BotRepository.class);

    /** 注册表在 SavedData 中的名称。 */
    private static final String DATA_NAME = "alice_bot_registry";

    // ---- Codec ---- //

    /** 持久化条目的 Codec。 */
    public record Entry(
            String name,
            String dimension,
            int x, int y, int z,
            long createdAt
    ) {
        static final Codec<Entry> CODEC = RecordCodecBuilder.create(i -> i.group(
                Codec.STRING.fieldOf("name").forGetter(Entry::name),
                Codec.STRING.fieldOf("dimension").forGetter(Entry::dimension),
                Codec.INT.fieldOf("x").forGetter(Entry::x),
                Codec.INT.fieldOf("y").forGetter(Entry::y),
                Codec.INT.fieldOf("z").forGetter(Entry::z),
                Codec.LONG.fieldOf("createdAt").forGetter(Entry::createdAt)
        ).apply(i, Entry::new));
    }

    private static final Codec<Map<UUID, Entry>> CODEC =
            Codec.unboundedMap(UUIDUtil.STRING_CODEC, Entry.CODEC);

    // ---- Factory ---- //

    private static final Factory<BotRepository> FACTORY = new Factory<>(
            BotRepository::new,
            BotRepository::load,
            net.minecraft.util.datafix.DataFixTypes.SAVED_DATA_RANDOM_SEQUENCES
    );

    // ---- 数据 ---- //

    private final Map<UUID, Entry> entries;

    private BotRepository() {
        this.entries = new HashMap<>();
    }

    private BotRepository(Map<UUID, Entry> entries) {
        this.entries = new HashMap<>(entries);
    }

    // ---- 获取实例 ---- //

    /** 从主世界数据存储中获取注册表实例。 */
    public static BotRepository get(MinecraftServer server) {
        return server.overworld().getDataStorage().computeIfAbsent(FACTORY, DATA_NAME);
    }

    // ---- CRUD ---- //

    /** 添加或更新假人条目。 */
    public void put(UUID uuid, BotEntry entry) {
        entries.put(uuid, new Entry(
                entry.name(),
                entry.dimension().toString(),
                entry.position().getX(),
                entry.position().getY(),
                entry.position().getZ(),
                entry.createdAt()
        ));
        setDirty();
    }

    /** 删除假人条目。 */
    public void remove(UUID uuid) {
        if (entries.remove(uuid) != null) {
            setDirty();
        }
    }

    /** 根据 UUID 查找条目。 */
    @Nullable
    public Entry find(UUID uuid) {
        return entries.get(uuid);
    }

    /** 根据名称查找 UUID。 */
    @Nullable
    public UUID findByName(String name) {
        for (Map.Entry<UUID, Entry> e : entries.entrySet()) {
            if (e.getValue().name().equals(name)) {
                return e.getKey();
            }
        }
        return null;
    }

    /** 获取所有条目。 */
    public List<Map.Entry<UUID, Entry>> all() {
        return List.copyOf(entries.entrySet());
    }

    /** 获取条目数量。 */
    public int size() {
        return entries.size();
    }

    // ---- SavedData 序列化 ---- //

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        CODEC.encodeStart(NbtOps.INSTANCE, entries)
                .result()
                .ifPresent(nbt -> {
                    if (nbt instanceof CompoundTag c) {
                        tag.merge(c);
                    }
                });
        return tag;
    }

    private static BotRepository load(CompoundTag tag, HolderLookup.Provider registries) {
        Map<UUID, Entry> map = CODEC.parse(NbtOps.INSTANCE, tag)
                .result()
                .orElse(new HashMap<>());
        return new BotRepository(map);
    }
}