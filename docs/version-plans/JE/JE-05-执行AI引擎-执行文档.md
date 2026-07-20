# JE 执行AI引擎 — 执行文档

> 版本：v1.0  
> 日期：2026-07-20  
> 模块：Alice Mod JE — 执行AI 引擎（C5）  
> 关联文档：[JE-05-执行AI引擎-状态机与行为树.md](JE-05-执行AI引擎-状态机与行为树.md)（设计文档）  
> 参考项目：[altoclef](libs/altoclef)、[adapter-bedrock/ai](packages/adapter-bedrock/src/ai)  

---

## 目录

1. [行为树完整图](#第1章-行为树完整图)
2. [移动状态机完整图](#第2章-移动状态机完整图)
3. [动作平滑设计](#第3章-动作平滑设计)
4. [抗反作弊策略](#第4章-抗反作弊策略)
5. [执行流程详解](#第5章-执行流程详解)
6. [实现步骤与代码对照](#第6章-实现步骤与代码对照)
7. [与现有工具层的集成](#第7章-与现有工具层的集成)

---

## 第1章 行为树完整图

### 1.1 行为树全景

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   行为树 (Behavior Tree)                              │
│                                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────────┐   │
│  │  Root: TaskRunner                                                          │   │
│  │  ├── [每 tick] 遍历所有 Chain，选最高优先级                                  │   │
│  │  └── [执行] 对最高优先级 Chain 调用 onTick()                                 │   │
│  └──────────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                              │
│           ┌────────────────────────────┼────────────────────────────┐                 │
│           ▼                            ▼                            ▼                 │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐            │
│  │   Sequence 节点   │      │   Sequence 节点   │      │   Sequence 节点   │            │
│  │  MLGBucketFallChain│      │  WorldSurvivalChain│      │  MobDefenseChain  │            │
│  │  Priority: 200    │      │  Priority: 100    │      │  Priority: 70/65  │            │
│  └──────────────────┘      └──────────────────┘      └──────────────────┘            │
│           │                          │                          │                    │
│           ▼                          ▼                          ▼                    │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐            │
│  │  FallCondition    │      │  SurvivalCondition│      │  HostileCondition │            │
│  │  isFallingOhNo()  │      │  inLava/inFire()  │      │  hasHostiles()    │            │
│  └──────────────────┘      └──────────────────┘      └──────────────────┘            │
│           │                          │                          │                    │
│           ▼                          ▼                          ▼                    │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐            │
│  │  Action:          │      │  Action:          │      │  Selector 节点    │            │
│  │  MLGBucketTask    │      │  EscapeFromLava   │      │  ├─ RunAway      │            │
│  │  (水桶落地)        │      │  /PutOutFire      │      │  ├─ DodgeArrow   │            │
│  └──────────────────┘      └──────────────────┘      │  └─ KillEntities  │            │
│                                                       └──────────────────┘            │
│                                                                                     │
│           ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐  │
│           │   Sequence 节点   │      │   Sequence 节点   │      │   Sequence 节点   │  │
│           │  FoodChain       │      │  UserTaskChain    │      │  WorldSurvival  │  │
│           │  Priority: 55    │      │  Priority: 50     │      │  (portal) P:60  │  │
│           └──────────────────┘      └──────────────────┘      └──────────────────┘  │
│                    │                          │                          │           │
│                    ▼                          ▼                          ▼           │
│           ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐  │
│           │  HungerCondition  │      │  UserCommand     │      │  PortalStuck     │  │
│           │  foodLevel < 6   │      │  setTask() 触发   │      │  stuckTimer>5s  │  │
│           └──────────────────┘      └──────────────────┘      └──────────────────┘  │
│                    │                          │                          │           │
│                    ▼                          ▼                          ▼           │
│           ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐  │
│           │  Action: EatTask  │      │  Action: 用户任务  │      │  Action:         │  │
│           │  (自动进食)        │      │  MoveTo/Mine/... │      │  ShimmyTask      │  │
│           └──────────────────┘      └──────────────────┘      └──────────────────┘  │
│                                                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  ConditionMonitor (横切关注点，每 tick 评估):                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────┐   │
│  │  LowHealth → STOP     │  Hunger → PAUSE      │  Enemy → PAUSE/STOP          │   │
│  │  FallRisk → REPLAN    │  Projectile → PAUSE  │  FireResist → 无影响          │   │
│  └──────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 行为树节点类型映射

| 行为树概念 | JE 实现 | 说明 |
|-----------|---------|------|
| **Root** | `TaskRunner` | 每 tick 选择最高优先级 Chain |
| **Selector** | `TaskRunner` 的优先级选择逻辑 | 从多个 Chain 中选一个 |
| **Sequence** | `TaskChain` → `SingleTaskChain` | 顺序执行子任务 |
| **Action** | `Task` 叶子节点 | 原子操作，不移交子任务 |
| **Condition** | `SingleTaskChain.getPriority()` | 在 getPriority() 中评估条件 |
| **Decorator** | `SingleTaskChain` 的 interrupt 管理 | 带中断/恢复的包装器 |
| **横切关注点** | `ConditionMonitor` | 每 tick 独立评估，不占 Chain 槽位 |

### 1.3 任务节点分类树

```
Task (抽象基类)
├── MovementTask (移动任务)
│   ├── MoveToTask          — 移动到坐标 (Baritone 驱动)
│   ├── FollowEntityTask    — 跟随实体
│   ├── RideTask            — 骑乘实体
│   ├── DismountTask        — 脱离骑乘
│   ├── EscapeFromLavaTask  — 逃离熔岩
│   └── DodgeProjectilesTask— 躲避弹射物
│
├── SurvivalTask (生存任务)
│   ├── EatTask             — 进食
│   ├── SleepTask           — 睡觉
│   └── UseItemTask         — 使用物品
│
├── BlockTask (方块任务)
│   ├── MineBlockTask       — 挖掘方块
│   ├── PlaceBlockTask      — 放置方块
│   ├── UseBlockTask        — 使用方块
│   └── AreaOperationTask   — 区域操作
│
├── InventoryTask (背包任务)
│   ├── DropItemTask        — 丢弃物品
│   ├── TakeFromContainerTask — 从容器取物
│   ├── PutToContainerTask  — 向容器放物
│   └── EquipItemTask       — 装备物品
│
├── CombatTask (战斗任务)
│   ├── SetCombatModeTask   — 设置战斗模式
│   └── StopCombatTask      — 停止战斗
│
├── EntityTask (实体任务)
│   ├── InteractEntityTask  — 实体交互
│   └── LeadEntityTask      — 拴绳
│
└── MiscTask (杂项)
    ├── IdleTask            — 空闲
    ├── TimeoutWanderTask   — 超时游荡
    └── MLGBucketTask       — 水桶落地
```

### 1.4 任务优先级抢占时序图

```
时间轴 →
──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────

[UserTaskChain P=50 运行中]
  MoveToTask 正在执行...
  │
  ├── Tick 1: 假人饥饿值降到 4
  │     └── FoodChain.getPriority() → 55
  │     └── TaskRunner 比较: 55 > 50 → 切换
  │     └── UserTaskChain.onInterrupt() → MoveToTask.interrupt()
  │     └── FoodChain.onTick() → EatTask.onStart()
  │
  ├── Tick 2~5: EatTask 执行中, 假人进食
  │     └── 输入: 按住右键
  │     └── 饥饿值上升
  │
  ├── Tick 6: 饥饿值回到 18
  │     └── FoodChain.getPriority() → Float.NEGATIVE_INFINITY
  │     └── TaskRunner 比较: 50 > -Inf → 切换回 UserTaskChain
  │     └── FoodChain.onInterrupt() → EatTask 被 interrupt
  │     └── UserTaskChain.onTick() → MoveToTask 自动 reset()
  │     └── MoveToTask 继续执行
  │
  ├── Tick 7: 僵尸靠近
  │     └── MobDefenseChain.getPriority() → 70
  │     └── TaskRunner 比较: 70 > 50 → 切换
  │     └── UserTaskChain.onInterrupt() → MoveToTask.interrupt()
  │     └── MobDefenseChain.onTick() → KillEntitiesTask
  │
  └── [僵尸被消灭后]
        └── MobDefenseChain.getPriority() → 0
        └── UserTaskChain 恢复 → MoveToTask.reset() → 继续
```

---

## 第2章 移动状态机完整图

### 2.1 状态转换图

```
                              ┌──────────────────┐
                              │                  │
                    ┌─────────│      WALK        │◀─────────┐
                    │         │    (默认状态)      │          │
                    │         │                  │          │
                    │         └──────────────────┘          │
                    │              │         ▲              │
                    │   ┌──────────┘         │              │
                    │   ▼                    │   sprintKey  │
                    │   sprintKey pressed    │   released   │
                    │   foodLevel >= 6       │              │
                    │         │         ┌────┘              │
                    │         ▼         ▼                   │
                    │   ┌──────────────────┐                │
                    │   │                  │                │
                    │   │     SPRINT       │────────────────┘
                    │   │                  │   foodLevel < 6
                    │   └──────────────────┘
                    │         │
                    │         │  跳跃键按下 + 疾跑中
                    │         ▼
                    │   ┌──────────────────┐
                    │   │                  │
                    │   │  SPRINT_JUMP     │──→ 落地后 → WALK
                    │   │  (疾跑跳跃)       │
                    │   └──────────────────┘
                    │
                    │   ┌──────────────────┐
                    │   │                  │
                    ├──→│      SWIM        │
                    │   │  (在水中/水面)     │
                    │   │                  │
                    │   └──────────────────┘
                    │         │         ▲
                    │         │         │
                    │         ▼         │
                    │   ┌──────────────────┐
                    │   │                  │
                    │   │     CLIMB        │
                    │   │  (梯子/藤蔓)      │
                    │   │                  │
                    │   └──────────────────┘
                    │
                    │   ┌──────────────────┐
                    │   │                  │
                    │   │    ELYTRA        │
                    │   │  (鞘翅滑翔)       │
                    │   │                  │
                    │   └──────────────────┘
                    │
                    │   ┌──────────────────┐
                    │   │                  │
                    │   │     RIDE         │
                    │   │  (骑乘实体)       │
                    │   │                  │
                    │   └──────────────────┘
                    │
                    │   ┌──────────────────┐
                    │   │                  │
                    │   │     BOAT         │
                    │   │  (乘船)           │
                    │   │                  │
                    │   └──────────────────┘

  ┌──────────────────┐
  │                  │
  │  BREAK_BLOCK     │  ← 从任何状态可进入，完成后退回前一个状态
  │  (破坏方块)       │
  │                  │
  └──────────────────┘

  ┌──────────────────┐
  │                  │
  │  PLACE_BLOCK     │  ← 从任何状态可进入，完成后退回前一个状态
  │  (放置方块)       │
  │                  │
  └──────────────────┘
```

### 2.2 状态转换表（完整版）

```
┌──────────────┬─────────────────────────────────────────────────────────────────────────────┐
│  当前状态     │  可转换到                                                                   │
├──────────────┼─────────────────────────────────────────────────────────────────────────────┤
│  WALK        │  SPRINT, SPRINT_JUMP, SWIM, CLIMB, ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK │
│  SPRINT      │  WALK, SPRINT_JUMP, SWIM, CLIMB, ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK │
│  SPRINT_JUMP │  WALK, SPRINT, SWIM, CLIMB, ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK        │
│  SWIM        │  WALK, SPRINT, CLIMB, ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK               │
│  CLIMB       │  WALK, SPRINT, SWIM, ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK                │
│  ELYTRA      │  WALK, SPRINT, SWIM, CLIMB, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK                 │
│  RIDE        │  WALK, SWIM, CLIMB, ELYTRA, BOAT, BREAK_BLOCK, PLACE_BLOCK                       │
│  BOAT        │  WALK, SWIM, CLIMB, ELYTRA, RIDE, BREAK_BLOCK, PLACE_BLOCK                       │
│  BREAK_BLOCK │  所有状态（完成后回到之前的状态）                                                  │
│  PLACE_BLOCK │  所有状态（完成后回到之前的状态）                                                  │
└──────────────┴─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 状态转换条件表

| 转换 | 条件 | 优先级 |
|------|------|:------:|
| WALK → SPRINT | 疾跑键按下 + 饥饿值 >= 6 + 无减速效果 | 立即 |
| SPRINT → WALK | 饥饿值 < 6 或 玩家松开疾跑键 | 立即 |
| WALK/SPRINT → SWIM | 头部在水中 或 身体在水中且跳跃键按下 | 立即 |
| SWIM → WALK/SPRINT | 头部离开水面 + 脚在固体方块上 | 延迟 2 tick |
| WALK/SPRINT → CLIMB | 在梯子/藤蔓上 + 有垂直输入 | 立即 |
| CLIMB → WALK/SPRINT | 离开梯子/藤蔓 或 脚在固体方块上 | 立即 |
| → ELYTRA | 鞘翅装备 + 跳跃键按下（空中） | 延迟 1 tick |
| ELYTRA → WALK | 碰撞地面 | 立即 |
| → RIDE | 假人 startRiding() 成功 | 单次触发 |
| → BOAT | 假人进入船实体 | 单次触发 |
| → BREAK_BLOCK | 挖掘指令下达 | 单次触发 |
| → PLACE_BLOCK | 放置指令下达 | 单次触发 |

### 2.4 状态机执行流程

```
每 tick:
  1. MovementExecutor.tick()
     │
     ├── 1.1 检查 MovementStateMachine 是否需要自动转换
     │     ├── 环境检测: 在水中? → 自动转 SWIM
     │     ├── 环境检测: 在梯子上? → 自动转 CLIMB
     │     └── 饥饿检测: foodLevel < 6? → 自动转 WALK（取消疾跑）
     │
     ├── 1.2 执行当前状态的动作
     │     ├── WALK:      向前移动 + 朝向目标
     │     ├── SPRINT:    向前移动 + 疾跑 + 朝向目标
     │     ├── SWIM:      水上移动 + 抬头
     │     ├── CLIMB:     垂直移动 + 梯子输入
     │     ├── ELYTRA:    滑翔 + 视角控制
     │     ├── RIDE/BOAT: 控制坐骑移动
     │     ├── BREAK_BLOCK: 挖掘动画 + 进度
     │     └── PLACE_BLOCK: 朝向 + 右键
     │
     ├── 1.3 平滑动作更新
     │     ├── 视角平滑: 逐渐旋转到目标朝向
     │     ├── 速度平滑: 加速度曲线控制速度变化
     │     └── 输入平滑: 按键按下/释放的渐变
     │
     └── 1.4 检查 MovementExecutor 是否完成当前段
           └── 是 → 通知父 Task 完成
           └── 否 → 继续下一 tick
```

---

## 第3章 动作平滑设计

### 3.1 设计原则

```
核心目标: 假人行为看起来像真实玩家，而不是外挂/机器人

原则:
1. 加速度限制 — 速度变化不是瞬时的，而是有加速度/减速度
2. 视角平滑 — 视角旋转不是一帧到位，而是有角速度限制
3. 输入缓冲 — 按键按下/释放加入延迟和抖动
4. 反应时间 — 在执行动作前加入随机延迟（模拟人类反应）
5. 精度随机 — 到达目标位置时允许微小误差，不追求完美
6. 动作重叠 — 动作之间不严格连续，加入微小间隔
```

### 3.2 视角平滑系统

```java
/**
 * 视角平滑控制器
 * 
 * 目标: 假人转头时像真实玩家一样平滑过渡，而不是瞬移视角
 * 
 * 设计:
 * - 角速度限制: 水平 max 180°/s, 垂直 max 90°/s
 * - 使用三次缓动函数 (ease-in-out cubic)
 * - 加入随机微小抖动 (±0.5°) 模拟手持鼠标的自然抖动
 * - 当目标角度差小于 1° 时，直接 snap 防止微小抖动
 */
public class SmoothLookController {
    // 当前实际视角
    private float currentYaw;
    private float currentPitch;
    // 目标视角
    private float targetYaw;
    private float targetPitch;
    // 平滑状态
    private float yawVelocity;      // 角速度
    private float pitchVelocity;
    private long lastUpdateTime;
    
    private static final float MAX_YAW_SPEED = 180f;    // 度/秒
    private static final float MAX_PITCH_SPEED = 90f;   // 度/秒
    private static final float SNAP_THRESHOLD = 1.0f;    // 小于此值直接 snap
    private static final float JITTER_AMPLITUDE = 0.5f;  // 随机抖动幅度
    
    /**
     * 设置目标视角（由路径规划器或任务调用）
     */
    public void setTarget(float yaw, float pitch) {
        this.targetYaw = normalizeAngle(yaw);
        this.targetPitch = clampPitch(pitch);
    }
    
    /**
     * 每 tick 调用，更新当前视角
     * @return 当前应应用的视角 (yaw, pitch)
     */
    public LookResult update() {
        long now = System.currentTimeMillis();
        float deltaTime = (now - lastUpdateTime) / 1000f;
        lastUpdateTime = now;
        
        float yawDiff = normalizeAngle(targetYaw - currentYaw);
        float pitchDiff = targetPitch - currentPitch;
        
        // 小角度直接 snap
        if (Math.abs(yawDiff) < SNAP_THRESHOLD && Math.abs(pitchDiff) < SNAP_THRESHOLD) {
            currentYaw = targetYaw;
            currentPitch = targetPitch;
            return new LookResult(currentYaw, currentPitch);
        }
        
        // 计算角速度（使用缓动函数）
        float yawStep = calculateSmoothStep(yawDiff, deltaTime, MAX_YAW_SPEED);
        float pitchStep = calculateSmoothStep(pitchDiff, deltaTime, MAX_PITCH_SPEED);
        
        // 应用速度限制
        yawStep = Math.signum(yawStep) * Math.min(Math.abs(yawStep), MAX_YAW_SPEED * deltaTime);
        pitchStep = Math.signum(pitchStep) * Math.min(Math.abs(pitchStep), MAX_PITCH_SPEED * deltaTime);
        
        currentYaw = normalizeAngle(currentYaw + yawStep);
        currentPitch = clampPitch(currentPitch + pitchStep);
        
        // 加入微小的随机抖动（模拟人类手持鼠标）
        float jitterYaw = (float)(Math.random() - 0.5) * JITTER_AMPLITUDE;
        float jitterPitch = (float)(Math.random() - 0.5) * JITTER_AMPLITUDE;
        
        return new LookResult(currentYaw + jitterYaw, currentPitch + jitterPitch);
    }
    
    /**
     * 三次缓动函数: 距离越近，速度越慢
     * 模拟人类瞄准时"先快后慢"的特征
     */
    private float calculateSmoothStep(float diff, float dt, float maxSpeed) {
        float absDiff = Math.abs(diff);
        float sign = Math.signum(diff);
        
        // 当距离大时，用最大速度
        // 当距离小时，用缓动比例
        float t = Math.min(1.0f, absDiff / 45.0f);  // 45° 为缓动参考
        float easedT = t * t * (3 - 2 * t);  // 三次 Hermite 插值
        
        return sign * maxSpeed * dt * easedT;
    }
}
```

### 3.3 移动平滑系统

```java
/**
 * 移动平滑控制器
 * 
 * 目标: 假人移动时看起来像真实玩家，而不是瞬移或固定速度
 * 
 * 设计:
 * - 加速度曲线: 起步慢→加速→匀速→减速→停止
 * - 速度受状态影响: 行走 4.3m/s, 疾跑 5.6m/s, 游泳 1.8m/s
 * - 加入随机速度波动 (±3%) 模拟真实玩家
 * - 转向时减速（模拟真实玩家拐弯时的减速）
 */
public class SmoothMovementController {
    private Vec3 currentVelocity = Vec3.ZERO;
    private Vec3 targetVelocity = Vec3.ZERO;
    private MoveMode currentMode = MoveMode.WALK;
    
    // 各模式最大速度 (m/s)
    private static final Map<MoveMode, Double> MAX_SPEEDS = Map.of(
        MoveMode.WALK,       4.317,
        MoveMode.SPRINT,     5.612,
        MoveMode.SWIM,       1.8,
        MoveMode.CLIMB,      2.0,
        MoveMode.ELYTRA,     10.0
    );
    
    // 各模式加速度 (m/s²)
    private static final Map<MoveMode, Double> ACCELERATIONS = Map.of(
        MoveMode.WALK,       8.0,   // 1.0 tick 到满速
        MoveMode.SPRINT,     6.0,   // 约 1.5 tick 到满速
        MoveMode.SWIM,       4.0,   // 水中加速慢
        MoveMode.CLIMB,      5.0,
        MoveMode.ELYTRA,     3.0    // 滑翔加速慢
    );
    
    private static final double SPEED_VARIANCE = 0.03;  // 3% 随机速度波动
    private static final double TURN_DECELERATION = 0.3; // 转向时减速 30%
    
    /**
     * 计算当前 tick 的目标速度
     */
    public Vec3 calculateVelocity(Vec3 direction, MoveMode mode, boolean isTurning) {
        double maxSpeed = MAX_SPEEDS.getOrDefault(mode, 4.317);
        double acceleration = ACCELERATIONS.getOrDefault(mode, 8.0);
        
        // 加入随机速度波动
        double variance = 1.0 + (Math.random() - 0.5) * 2 * SPEED_VARIANCE;
        double actualMaxSpeed = maxSpeed * variance;
        
        // 转向时减速
        if (isTurning) {
            actualMaxSpeed *= (1.0 - TURN_DECELERATION);
        }
        
        // 加速度计算
        Vec3 desiredVelocity = direction.normalize().scale(actualMaxSpeed);
        Vec3 velocityDiff = desiredVelocity.subtract(currentVelocity);
        
        double maxDelta = acceleration * 0.05; // 每 tick 最大速度变化 (50ms)
        if (velocityDiff.length() > maxDelta) {
            velocityDiff = velocityDiff.normalize().scale(maxDelta);
        }
        
        currentVelocity = currentVelocity.add(velocityDiff);
        return currentVelocity;
    }
}
```

### 3.4 输入平滑系统

```java
/**
 * 输入平滑控制器
 * 
 * 目标: 模拟真实玩家的按键行为，不是瞬间按下/释放
 * 
 * 设计:
 * - 按键按下/释放加入随机延迟 (50-200ms)
 * - 连续动作之间加入随机间隔 (100-300ms)
 * - 使用输入缓冲队列，而不是直接操作 KeyBinding
 */
public class SmoothInputController {
    private static final long MIN_PRESS_DELAY = 50;   // 最短按下延迟
    private static final long MAX_PRESS_DELAY = 200;  // 最长按下延迟
    private static final long MIN_ACTION_GAP = 100;    // 动作间最少间隔
    private static final long MAX_ACTION_GAP = 300;    // 动作间最大间隔
    
    private final Queue<ScheduledInput> inputQueue = new LinkedList<>();
    private long lastActionTime = 0;
    
    /**
     * 安排一个输入动作（带随机延迟）
     */
    public void scheduleInput(Input input, boolean pressed) {
        long delay = MIN_PRESS_DELAY + 
            (long)(Math.random() * (MAX_PRESS_DELAY - MIN_PRESS_DELAY));
        long gap = MIN_ACTION_GAP + 
            (long)(Math.random() * (MAX_ACTION_GAP - MIN_ACTION_GAP));
        
        long executeTime = System.currentTimeMillis() + delay + gap;
        inputQueue.add(new ScheduledInput(input, pressed, executeTime));
    }
    
    /**
     * 每 tick 调用，处理到期的输入
     */
    public void processInputQueue() {
        long now = System.currentTimeMillis();
        while (!inputQueue.isEmpty() && inputQueue.peek().executeTime <= now) {
            ScheduledInput si = inputQueue.poll();
            applyInput(si.input, si.pressed);
            lastActionTime = now;
        }
    }
    
    private void applyInput(Input input, boolean pressed) {
        // 通过 Carpet ActionPack 或 KeyBinding 应用输入
        KeyBinding keyBinding = getKeyBinding(input);
        if (pressed) {
            keyBinding.setPressed(true);
            KeyBinding.onKeyPressed(keyBinding.getDefaultKey());
        } else {
            keyBinding.setPressed(false);
        }
    }
}
```

### 3.5 真实玩家行为模拟参数总表

| 行为 | 参数 | 值 | 说明 |
|------|------|:--:|------|
| 视角旋转 | 最大角速度 | 180°/s 水平, 90°/s 垂直 | 不瞬移 |
| 视角旋转 | 抖动幅度 | ±0.5° | 模拟手持鼠标 |
| 视角旋转 | Snap 阈值 | 1.0° | 小角度直接到 |
| 移动速度 | 行走 | 4.317 m/s | 原版速度 |
| 移动速度 | 疾跑 | 5.612 m/s | 原版速度 |
| 移动速度 | 游泳 | 1.8 m/s | 原版速度 |
| 移动速度 | 速度波动 | ±3% | 随机变化 |
| 加速度 | 行走 | 8.0 m/s² | 约 1 tick 满速 |
| 加速度 | 疾跑 | 6.0 m/s² | 约 1.5 tick 满速 |
| 加速度 | 游泳 | 4.0 m/s² | 水中慢 |
| 输入延迟 | 按键按下 | 50-200ms 随机 | 模拟反应时间 |
| 动作间隔 | 连续动作 | 100-300ms 随机 | 不连续执行 |
| 挖掘 | 挖掘延迟 | 50-150ms 随机 | 不说立即挖掘 |
| 放置 | 放置延迟 | 100-200ms 随机 | 不连续放置 |
| 进食 | 进食前延迟 | 200-400ms 随机 | 模拟选择食物 |
| 攻击 | 攻击间隔 | 按武器速度 | 不加速攻击 |

---

## 第4章 抗反作弊策略

### 4.1 风险分析

| 行为 | 反作弊风险 | 缓解策略 |
|------|:----------:|---------|
| 视角瞬移 | 高 | 使用 SmoothLookController，限制角速度 |
| 速度异常 | 高 | 使用原版速度值，不修改移动属性 |
| 瞬间挖掘 | 高 | 模拟完整挖掘进度，不跳过 |
| 高频率攻击 | 中 | 遵守武器攻击速度，不加速 |
| 同步移动 | 中 | 不完全同步，加入随机延迟 |
| 路径穿透 | 高 | 使用 Baritone 寻路，不直接操作位置 |
| 物品操作 | 中 | 模拟 GUI 操作，不直接修改背包 |

### 4.2 关键实现约束

```java
/**
 * 抗反作弊约束规则
 * 
 * 所有动作执行必须遵守以下规则:
 */
public class AntiCheatConstraints {
    
    /** 规则1: 永远不直接修改玩家位置或速度 */
    public static final boolean NEVER_TELEPORT = true;
    // 使用: Baritone 寻路 + Carpet ActionPack 移动
    // 禁止: bot.teleportTo(), player.setPos(), player.setVelocity()
    
    /** 规则2: 永远不修改游戏 tick 速度 */
    public static final boolean NEVER_MODIFY_TICK_SPEED = true;
    // 使用: 正常 tick 循环
    // 禁止: 加速 tick, 跳过 tick
    
    /** 规则3: 遵守原版动作速度限制 */
    public static final boolean RESPECT_VANILLA_SPEED = true;
    // 挖掘: 遵守方块硬度 + 工具速度
    // 攻击: 遵守武器攻击速度 (20 tick / 攻击速度)
    // 进食: 遵守进食时间 (32 tick)
    
    /** 规则4: 所有动作通过合法输入触发 */
    public static final boolean USE_LEGIT_INPUTS = true;
    // 使用: KeyBinding, Carpet ActionPack
    // 禁止: 直接发送网络包模拟操作
    
    /** 规则5: 模拟真实玩家操作间隔 */
    public static final boolean SIMULATE_HUMAN_DELAYS = true;
    // 工具切换: 100-200ms 延迟
    // 物品选择: 50-150ms 延迟
    // 交互确认: 100-300ms 延迟
}
```

### 4.3 动作时序控制

```
挖掘方块时序:
  Tick 0: 看向方块 (SmoothLookController, 需 2-5 tick 完成)
  Tick 3: 切换到合适工具 (SlotHandler, 100ms 延迟)
  Tick 5: 开始挖掘 (按住左键)
  Tick 6+: 挖掘进度条增长 (遵守方块硬度)
  Tick N: 方块破碎 (进度满)
  Tick N+2: 松开左键 (100ms 延迟)
  总耗时: 方块硬度相关 + 人类延迟 ~300ms

进食时序:
  Tick 0: 看向天空或安全方向
  Tick 1: 切换到食物 (SlotHandler, 100ms 延迟)
  Tick 3: 开始进食 (按住右键)
  Tick 4-35: 进食动画 (32 tick)
  Tick 36: 进食完成
  Tick 38: 松开右键 (100ms 延迟)
  总耗时: 32 tick (1.6s) + 人类延迟 ~400ms

攻击时序:
  Tick 0: 看向目标 (SmoothLookController)
  Tick 2: 切换到武器 (SlotHandler, 100ms 延迟)
  Tick 4: 攻击 (左键点击)
  Tick 5: 等待攻击冷却 (按武器速度)
  Tick N+2: 下一次攻击
  攻击间隔: 20 tick / 攻击速度 (剑: 12.5 tick = 0.625s)
```

---

## 第5章 执行流程详解

### 5.1 完整单 tick 执行流程

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            每 ServerTick (50ms) 执行流程                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  1. TrackerManager.tick()                                                           │
│     ├── EntityTracker.tick()      — 更新实体列表（异步，不阻塞）                       │
│     ├── BlockTracker.setDirty()   — 标记方块数据脏                                    │
│     └── ItemStorageTracker.refresh() — 更新背包缓存                                   │
│                                                                                     │
│  2. ConditionMonitor.evaluate(ctx)                                                  │
│     ├── LowHealthCondition        → 健康度检查                                       │
│     ├── HungerCondition           → 饥饿度检查                                       │
│     ├── EnemyDetectedCondition    → 敌对实体检测                                     │
│     └── FallRiskCondition         → 掉落风险检测                                     │
│     └── 如果有 STOP 信号 → TaskRunner 中断当前任务                                    │
│                                                                                     │
│  3. TaskRunner.tick()                                                               │
│     ├── 遍历所有 Chain，调用 getPriority()                                           │
│     │   ├── UserTaskChain.getPriority()   → 50（有任务时）                           │
│     │   ├── FoodChain.getPriority()       → 55（饥饿时）                             │
│     │   ├── MobDefenseChain.getPriority() → 70（有敌人时）                           │
│     │   ├── WorldSurvivalChain.getPriority() → 100（熔岩/火中）                      │
│     │   └── MLGBucketFallChain.getPriority() → 200（坠落时）                         │
│     │                                                                               │
│     ├── 选择最高优先级 Chain                                                         │
│     │   └── 如果不同于当前 Chain → 旧 Chain.onInterrupt()                            │
│     │                                                                               │
│     └── 最高优先级 Chain.onTick()                                                   │
│         └── SingleTaskChain.onTick()                                                │
│             └── Task.tick()                                                         │
│                 ├── if (第一次) → onStart()                                          │
│                 ├── onTick() → 返回子 Task 或 null                                   │
│                 └── 如果返回子 Task → 子 Task.tick()（递归）                          │
│                                                                                     │
│  4. MovementExecutor.tick()  (如果当前 Task 是移动任务)                               │
│     ├── SmoothLookController.update()  → 更新视角                                    │
│     ├── MovementStateMachine 检查自动转换                                             │
│     ├── SmoothMovementController 计算速度                                             │
│     └── ActionController 应用输入                                                    │
│                                                                                     │
│  5. SmoothInputController.processInputQueue()                                        │
│     └── 处理到期的输入事件                                                           │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 任务执行流程 (MoveToTask 为例)

```
LLM 调用 move_to({x: 100, y: 64, z: 200})
  │
  ▼
MoveToTools.moveTo()  (工具层)
  │
  ▼
MoveToTask.onStart()  (行为树层)
  ├── 1. 获取目标位置 (100, 64, 200)
  ├── 2. 调用 Baritone 寻路 → 获取 Path
  ├── 3. 将 Path 分解为 PathSegment 列表
  ├── 4. 初始化 MovementExecutor
  └── 5. 注册 ConditionMonitor 回调
  │
  ▼
MoveToTask.onTick()  (每 tick)
  ├── 1. 检查 isFinished() → 距离 < 1.5? 是 → 返回 null (完成)
  ├── 2. ConditionMonitor.evaluate() → 有 STOP? 是 → 返回 null (中断)
  ├── 3. MovementExecutor.continueTick()
  │     ├── 获取当前 PathSegment
  │     ├── MovementStateMachine 转换到对应模式
  │     ├── SmoothLookController 看向下一个 Waypoint
  │     ├── SmoothMovementController 计算速度
  │     └── ActionController 应用移动输入
  └── 4. 返回 null (持续执行)
  │
  ▼
MoveToTask.onStop()  (中断或完成)
  ├── 1. MovementExecutor.stop()
  ├── 2. SmoothLookController 停止
  ├── 3. ActionController.stopAll()
  └── 4. 清理 Baritone 状态
```

### 5.3 中断恢复流程

```
当前: UserTaskChain 执行 MoveToTask
  │
  ├── Tick N: 僵尸出现
  │     ├── MobDefenseChain.getPriority() → 70 (> 50)
  │     ├── TaskRunner 检测到优先级变化
  │     ├── UserTaskChain.onInterrupt()
  │     │     └── MoveToTask.interrupt()
  │     │           ├── onStop() 被调用 (清理)
  │     │           └── _first 设为 true (下次 tick 重新 onStart)
  │     └── MobDefenseChain.onTick()
  │           └── KillEntitiesTask.onStart()
  │
  ├── Tick N+5: 僵尸被消灭
  │     ├── MobDefenseChain.getPriority() → 0
  │     ├── TaskRunner 检测到优先级变化
  │     ├── MobDefenseChain.onInterrupt()
  │     │     └── KillEntitiesTask.interrupt()
  │     └── UserTaskChain.onTick()
  │           └── MoveToTask.tick()
  │                 ├── _first = true → onStart() 重新执行
  │                 └── 继续移动到目标
  │
  └── 恢复完成，行为无缝衔接
```

---

## 第6章 实现步骤与代码对照

### 6.1 Phase 1: 基础框架实现

#### 步骤 1.1: 移植 Task.java

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/behavior/Task.java`

**参考代码**: `libs/altoclef/src/main/java/adris/altoclef/tasksystem/Task.java`

**关键修改**:
- 将 `AltoClef mod` 参数替换为 `BotAccess` 或 `BotHandle`
- 保留 `tick()/stop()/interrupt()/reset()` 的完整生命周期逻辑
- 保留 `canBeInterrupted()` 和 `ITaskCanForce` 接口
- 保留 `thisOrChildSatisfies()` 链式查询

```java
// 核心签名 (从 altoclef 移植)
public abstract class Task {
    // 生命周期
    protected abstract void onStart(BotHandle bot);
    protected abstract Task onTick(BotHandle bot);
    protected abstract void onStop(BotHandle bot, Task interruptTask);
    
    // 状态查询
    public abstract boolean isFinished(BotHandle bot);
    protected abstract boolean isEqual(Task other);
    protected abstract String toDebugString();
    
    // 框架调用
    public void tick(BotHandle bot, TaskChain parentChain);
    public void stop(BotHandle bot, Task interruptTask);
    public void interrupt(BotHandle bot, Task interruptTask);
    public void reset();
}
```

#### 步骤 1.2: 移植 TaskChain.java

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/behavior/TaskChain.java`

**参考代码**: `libs/altoclef/src/main/java/adris/altoclef/tasksystem/TaskChain.java`

```java
public abstract class TaskChain {
    // 核心抽象
    public abstract float getPriority(BotHandle bot);
    public abstract boolean isActive();
    public abstract String getName();
    public abstract void onInterrupt(BotHandle bot, TaskChain other);
    
    // 框架调用
    public void tick(BotHandle bot);
    public void stop(BotHandle bot);
    
    // 任务链追踪
    public List<Task> getTasks();
    void addTaskToChain(Task task);
}
```

#### 步骤 1.3: 移植 TaskRunner.java

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/behavior/TaskRunner.java`

**参考代码**: `libs/altoclef/src/main/java/adris/altoclef/tasksystem/TaskRunner.java`

```java
public class TaskRunner {
    private List<TaskChain> chains = new ArrayList<>();
    private TaskChain currentChain = null;
    private boolean active = false;
    
    public void tick();           // 每 tick 调用
    public void addTaskChain(TaskChain chain);
    public void enable();
    public void disable();
    public TaskChain getCurrentTaskChain();
}
```

#### 步骤 1.4: 移植 SingleTaskChain.java

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/behavior/SingleTaskChain.java`

**参考代码**: `libs/altoclef/src/main/java/adris/altoclef/chains/SingleTaskChain.java`

```java
public abstract class SingleTaskChain extends TaskChain {
    protected Task mainTask = null;
    private boolean interrupted = false;
    
    public void setTask(Task task);   // 替换当前任务
    protected abstract void onTaskFinish(BotHandle bot);
    
    // 中断处理: 标记中断，下次 tick 自动 reset
    public void onInterrupt(BotHandle bot, TaskChain other);
}
```

#### 步骤 1.5: 移植 EventBus.java

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/event/EventBus.java`

**参考代码**: `libs/altoclef/src/main/java/adris/altoclef/eventbus/EventBus.java`

```java
public class EventBus {
    public static <T> void publish(T event);
    public static <T> Subscription<T> subscribe(Class<T> type, Consumer<T> handler);
    public static <T> void unsubscribe(Subscription<T> subscription);
}
```

### 6.2 Phase 2: 移动系统实现

#### 步骤 2.1: 实现 MoveMode 枚举

```java
public enum MoveMode {
    WALK, SPRINT, SPRINT_JUMP, SWIM, CLIMB, 
    ELYTRA, RIDE, BOAT, BREAK_BLOCK, PLACE_BLOCK
}
```

#### 步骤 2.2: 实现 MovementStateMachine

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/state/MovementStateMachine.java`

**参考**: BE `packages/adapter-bedrock/src/ai/movement/state-machine.ts`

```java
public class MovementStateMachine {
    private MoveMode state = MoveMode.WALK;
    private MoveMode previousState = MoveMode.WALK;  // 用于 BREAK/PLACE 后恢复
    
    public MoveMode getState();
    public boolean transition(MoveMode to, MovementContext ctx);
    public void reset();
    public MoveMode getPreviousState();  // BREAK/PLACE 完成后恢复
}
```

#### 步骤 2.3: 实现 SmoothLookController

**位置**: `packages/adapter-java/src/main/java/io/alice/mod/adapter/ai/state/SmoothLookController.java`

```java
public class SmoothLookController {
    public void setTarget(float yaw, float pitch);  // 设置目标视角
    public LookResult update();                       // 每 tick 更新
    public void snapTo(float yaw, float pitch);      // 紧急 snap（用于条件触发）
}
```

#### 步骤 2.4: 实现 SmoothMovementController

```java
public class SmoothMovementController {
    public Vec3 calculateVelocity(Vec3 direction, MoveMode mode, boolean isTurning);
    public void reset();
}
```

#### 步骤 2.5: 实现 SmoothInputController

```java
public class SmoothInputController {
    public void scheduleInput(Input input, boolean pressed);
    public void processInputQueue();
    public void hold(Input input);      // 持续按住
    public void release(Input input);   // 释放
}
```

#### 步骤 2.6: 实现 ActionController

```java
public class ActionController {
    // Carpet ActionPack 封装
    public boolean moveTo(Vec3 target, double speed);
    public void lookAt(Vec3 target);
    public void setSprint(boolean sprint);
    public void jump();
    public void attack(Entity target);
    public void useItem();
    public boolean breakBlock(BlockPos pos);
    public boolean placeBlock(BlockPos pos, Direction face);
    public void stopAll();
}
```

#### 步骤 2.7: 实现 MovementExecutor

```java
public class MovementExecutor {
    private MovementStateMachine stateMachine;
    private SmoothLookController lookController;
    private SmoothMovementController movementController;
    private ActionController actionController;
    private ConditionMonitor conditionMonitor;
    
    public MoveResult execute(Path path, MovementContext ctx);
    public void continueTick();  // 每 tick 继续执行
    public void stop();
    public boolean isFinished();
}
```

### 6.3 Phase 3: Chain 系统实现

#### 步骤 3.1: UserTaskChain

```java
public class UserTaskChain extends SingleTaskChain {
    public float getPriority(BotHandle bot) { return 50; }
    public void runTask(BotHandle bot, Task task, Runnable onFinish);
    public void cancel(BotHandle bot);
}
```

#### 步骤 3.2: FoodChain

```java
public class FoodChain extends SingleTaskChain {
    public float getPriority(BotHandle bot) {
        // 饥饿值 < 6 → 返回 55
        // 有食物且饥饿值可接受 → 返回 Float.NEGATIVE_INFINITY
    }
    // 自动选择最佳食物并进食
}
```

#### 步骤 3.3: MobDefenseChain

```java
public class MobDefenseChain extends SingleTaskChain {
    public float getPriority(BotHandle bot) {
        // 有敌对实体靠近 → 返回 70
        // 爬行者即将爆炸 → 返回 100+
        // 安全 → 返回 0
    }
    // 自动攻击/逃跑/闪避
}
```

#### 步骤 3.4: WorldSurvivalChain

```java
public class WorldSurvivalChain extends SingleTaskChain {
    public float getPriority(BotHandle bot) {
        // 在熔岩中 → 返回 100
        // 着火 → 返回 90
        // 传送门卡住 → 返回 60
        // 安全 → 返回 Float.NEGATIVE_INFINITY
    }
    // 熔岩逃生/灭火/传送门自救
}
```

#### 步骤 3.5: MLGBucketFallChain

```java
public class MLGBucketFallChain extends SingleTaskChain {
    public float getPriority(BotHandle bot) {
        // 自由落体速度 > -0.7 → 返回 200
        // 安全 → 返回 Float.NEGATIVE_INFINITY
    }
    // 水桶落地
}
```

### 6.4 Phase 4: 追踪器实现

#### 步骤 4.1: Tracker 基类

```java
public abstract class Tracker {
    protected BotHandle bot;
    public abstract void setDirty();
    public abstract void reset();
}
```

#### 步骤 4.2: TrackerManager

```java
public class TrackerManager {
    private List<Tracker> trackers = new ArrayList<>();
    public void tick();           // 每 tick 调用
    public void addTracker(Tracker tracker);
}
```

#### 步骤 4.3: EntityTracker

```java
public class EntityTracker extends Tracker {
    public void tick();  // 扫描世界，更新实体列表
    public <T extends Entity> List<T> getTrackedEntities(Class<T> type);
    public Optional<Entity> getClosestEntity(Vec3 pos, Class<?>... types);
    public boolean hasHostiles();
    public List<Entity> getHostiles();
}
```

#### 步骤 4.4: BlockTracker

```java
public class BlockTracker extends Tracker {
    public void trackBlock(Block... blocks);
    public void stopTracking(Block... blocks);
    public Optional<BlockPos> getNearestTracking(Vec3 pos, Block... blocks);
    public boolean blockIsValid(BlockPos pos, Block... blocks);
}
```

#### 步骤 4.5: ItemStorageTracker

```java
public class ItemStorageTracker extends Tracker {
    public void refresh();
    public boolean hasItem(Item item);
    public int getItemCount(Item item);
    public boolean hasItem(Item item, int minCount);
}
```

### 6.5 Phase 5: 任务实现

#### 各任务类实现要点

| 任务 | 关键行为 | 动作控制 | 完成条件 |
|------|---------|---------|---------|
| MoveToTask | Baritone 寻路 → MovementExecutor 执行 | SmoothLook + SmoothMovement | 距离目标 < 1.5 |
| FollowEntityTask | 每 tick 更新目标位置 | 同 MoveToTask | 实体消失或距离过近 |
| MineBlockTask | 看向方块 → 装备工具 → 挖掘 | 按住左键，SmoothLook | 方块消失 |
| PlaceBlockTask | 看向目标面 → 装备方块 → 右键 | 看向目标面，SingleClick | 方块出现 |
| EatTask | 看向安全方向 → 装备食物 → 右键 | 按住右键，SmoothLook | 饥饿值满 |
| SleepTask | 移动到床 → 右键床 | 看向床，SingleClick | 进入睡眠状态 |
| DropItemTask | 打开背包 → 选择物品 → 丢出 | SlotHandler | 物品数量减少 |
| AttackTask | 看向目标 → 攻击 | 左键点击，SmoothLook | 目标死亡 |

---

## 第7章 与现有工具层的集成

### 7.1 集成架构

```
工具层 (Tool Layer)                       行为层 (Behavior Layer)
┌──────────────┐                        ┌──────────────────────┐
│ MoveToTools  │──── move_to ──────────▶│  UserTaskChain       │
│ BlockTools   │──── mine_block ───────▶│   └── MoveToTask     │
│ SurvivalTools│──── eat ──────────────▶│   └── MineBlockTask  │
│ InventoryTools│─── drop_item ────────▶│   └── EatTask        │
│ CombatTools  │──── attack ───────────▶│   └── DropItemTask   │
└──────────────┘                        └──────────────────────┘
                                               │
                                               ▼
                                        ┌──────────────────────┐
                                        │  ConditionMonitor    │
                                        │  (横切关注点)         │
                                        └──────────────────────┘
                                               │
                                               ▼
                                        ┌──────────────────────┐
                                        │  MovementExecutor    │
                                        │  (状态机)             │
                                        └──────────────────────┘
                                               │
                                               ▼
                                        ┌──────────────────────┐
                                        │  ActionController    │
                                        │  (Carpet ActionPack)  │
                                        └──────────────────────┘
```

### 7.2 Controller 改造对照

| 现有 Controller | 当前实现 | 改造后实现 |
|---------------|---------|-----------|
| MovementController.moveTo() | teleport 传送 | → MoveToTask → MovementExecutor |
| MovementController.followEntity() | teleport 传送 | → FollowEntityTask → MovementExecutor |
| BlockController.mineBlock() | 直接发送网络包 | → MineBlockTask → ActionController.breakBlock |
| BlockController.placeBlock() | 直接发送网络包 | → PlaceBlockTask → ActionController.placeBlock |
| BlockController.useBlock() | 直接发送网络包 | → UseBlockTask → ActionController.useItem |
| SurvivalController.eat() | 直接修改数据 | → EatTask → InputControls.hold(CLICK_RIGHT) |
| InventoryController.dropItem() | 直接修改背包 | → DropItemTask → SlotHandler |
| InventoryController.takeFromContainer() | 直接修改容器 | → TakeFromContainerTask → SlotHandler |

### 7.3 改造步骤（以 MoveToTools 为例）

```java
@ToolModule(category = "movement", description = "移动类工具")
public enum MoveToTools {
    INSTANCE;
    
    @ToolMethod(name = "move_to", description = "移动到目标位置")
    public ToolResult moveTo(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        
        // 1. 解析参数
        double x = ((Number) params.get("x")).doubleValue();
        Double y = params.containsKey("y") ? ((Number) params.get("y")).doubleValue() : null;
        double z = ((Number) params.get("z")).doubleValue();
        
        // 2. 通过 BotAccess 获取 TaskRunner
        TaskRunner runner = BotAccess.getTaskRunner();
        UserTaskChain userChain = runner.getUserTaskChain();
        
        // 3. 创建 MoveToTask 并提交
        Vec3 target = new Vec3(x, y != null ? y : BotAccess.getBot().getY(), z);
        MoveToTask task = new MoveToTask(target);
        
        // 4. 设置任务并等待完成
        CompletableFuture<ToolResult> future = new CompletableFuture<>();
        userChain.runTask(BotAccess.getBotHandle(), task, () -> {
            future.complete(ToolResult.ok("已移动到目标位置", null, start));
        });
        
        // 5. 超时机制
        try {
            return future.get(30, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            userChain.cancel(BotAccess.getBotHandle());
            return ToolResult.fail("TIMEOUT", "移动超时", start);
        }
    }
}
```

### 7.4 初始化代码

```java
// 在 AliceModServer 或模组初始化时
public class AliceModServer {
    private TaskRunner taskRunner;
    private TrackerManager trackerManager;
    private ConditionMonitor conditionMonitor;
    
    public void onServerStarted(MinecraftServer server) {
        // 1. 创建核心组件
        taskRunner = new TaskRunner();
        trackerManager = new TrackerManager();
        conditionMonitor = new ConditionMonitor();
        
        // 2. 注册 Chain
        new UserTaskChain(taskRunner);
        new FoodChain(taskRunner);
        new MobDefenseChain(taskRunner);
        new WorldSurvivalChain(taskRunner);
        new MLGBucketFallChain(taskRunner);
        
        // 3. 注册 Tracker
        trackerManager.addTracker(new EntityTracker());
        trackerManager.addTracker(new BlockTracker());
        trackerManager.addTracker(new ItemStorageTracker());
        
        // 4. 启动 tick 驱动
        ServerLifecycleEvents.SERVER_TICK.register(() -> {
            trackerManager.tick();
            conditionMonitor.evaluate(BotAccess.getBotHandle());
            taskRunner.tick();
        });
        
        // 5. 启用 TaskRunner
        taskRunner.enable();
    }
}
```

---

## 附录A: 文件创建清单

```
src/main/java/io/alice/mod/adapter/ai/
├── behavior/
│   ├── Task.java                    # 从 altoclef 移植
│   ├── TaskChain.java               # 从 altoclef 移植
│   ├── SingleTaskChain.java         # 从 altoclef 移植
│   ├── TaskRunner.java              # 从 altoclef 移植
│   ├── chain/
│   │   ├── UserTaskChain.java       # 从 altoclef 移植
│   │   ├── FoodChain.java           # 从 altoclef 移植
│   │   ├── MobDefenseChain.java     # 从 altoclef 移植
│   │   ├── WorldSurvivalChain.java  # 从 altoclef 移植
│   │   └── MLGBucketFallChain.java  # 从 altoclef 移植
│   └── task/
│       ├── movement/
│       │   ├── MoveToTask.java
│       │   ├── FollowEntityTask.java
│       │   ├── RideTask.java
│       │   ├── DismountTask.java
│       │   ├── EscapeFromLavaTask.java
│       │   └── DodgeProjectilesTask.java
│       ├── survival/
│       │   ├── EatTask.java
│       │   ├── SleepTask.java
│       │   └── UseItemTask.java
│       ├── block/
│       │   ├── MineBlockTask.java
│       │   ├── PlaceBlockTask.java
│       │   ├── UseBlockTask.java
│       │   └── AreaOperationTask.java
│       ├── inventory/
│       │   ├── DropItemTask.java
│       │   ├── TakeFromContainerTask.java
│       │   ├── PutToContainerTask.java
│       │   └── EquipItemTask.java
│       ├── combat/
│       │   ├── SetCombatModeTask.java
│       │   └── StopCombatTask.java
│       ├── entity/
│       │   ├── InteractEntityTask.java
│       │   └── LeadEntityTask.java
│       └── misc/
│           ├── IdleTask.java
│           └── TimeoutWanderTask.java
├── state/
│   ├── MovementStateMachine.java    # 从 BE 移植
│   ├── MovementExecutor.java        # 从 BE 移植
│   ├── ActionController.java        # 从 BE 移植
│   ├── SmoothLookController.java    # 新增: 视角平滑
│   ├── SmoothMovementController.java # 新增: 移动平滑
│   └── SmoothInputController.java   # 新增: 输入平滑
├── condition/
│   ├── ConditionMonitor.java
│   ├── IExecutionCondition.java
│   ├── LowHealthCondition.java
│   ├── HungerCondition.java
│   ├── EnemyDetectedCondition.java
│   └── FallRiskCondition.java
├── tracker/
│   ├── Tracker.java                 # 从 altoclef 移植
│   ├── TrackerManager.java          # 从 altoclef 移植
│   ├── EntityTracker.java           # 从 altoclef 移植
│   ├── BlockTracker.java            # 从 altoclef 移植
│   └── ItemStorageTracker.java      # 从 altoclef 移植
├── control/
│   ├── InputControls.java           # 从 altoclef 移植
│   ├── KillAura.java                # 从 altoclef 移植
│   └── SlotHandler.java             # 从 altoclef 移植
└── event/
    ├── EventBus.java                # 从 altoclef 移植
    └── events/
        ├── ClientTickEvent.java
        ├── TaskFinishedEvent.java
        └── BotDeathEvent.java
```

## 附录B: 关键时序参数

| 参数 | 默认值 | 说明 |
|------|:------:|------|
| 视角最大角速度 (水平) | 180°/s | 模拟人类转头速度 |
| 视角最大角速度 (垂直) | 90°/s | 垂直转头更慢 |
| 视角抖动幅度 | ±0.5° | 模拟手持鼠标 |
| 行走速度 | 4.317 m/s | 原版值 |
| 疾跑速度 | 5.612 m/s | 原版值 |
| 游泳速度 | 1.8 m/s | 原版值 |
| 行走加速度 | 8.0 m/s² | 约 1 tick 到满速 |
| 疾跑加速度 | 6.0 m/s² | 约 1.5 tick 到满速 |
| 速度随机波动 | ±3% | 模拟真实玩家 |
| 转向减速 | 30% | 拐弯时减速 |
| 按键按下延迟 | 50-200ms | 随机反应时间 |
| 动作间间隔 | 100-300ms | 随机间隔 |
| 挖掘前延迟 | 50-150ms | 模拟选择工具 |
| 放置前延迟 | 100-200ms | 模拟选择方块 |
| 进食前延迟 | 200-400ms | 模拟选择食物 |
| 移动完成精度 | 1.5 blocks | 不追求完美到达 |
| Chain 优先级 | 50-200 | 生存>防御>进食>任务 |
| 任务超时 | 30s | 超时自动取消 |