# JE 执行AI引擎 — 状态机与行为树

> 版本：v1.0
> 日期：2026-07-20
> 模块：Alice Mod JE — 执行AI 引擎（C5）
> 关联文档：[JE-01-需求文档.md](JE-01-需求文档.md)、[JE-04-架构与开发路线.md](JE-04-架构与开发路线.md)、[15-执行层开发规划.md](../tools/15-执行层开发规划.md)
> 参考项目：[altoclef](libs/altoclef)、[adapter-bedrock/ai](packages/adapter-bedrock/src/ai)

---

## 第1章 概述

### 1.1 模块定位

执行AI 引擎是 Alice Mod JE 中负责**假人自主行为控制**的核心模块。它接收来自工具层的抽象指令（如"移动到坐标"、"挖掘方块"、"攻击实体"），将其分解为可执行的原子动作序列，并通过状态机和行为树实现**安全、稳定、可中断**的任务执行。

**核心职责**：
- **状态机（State Machine）**：管理假人的移动模式（走/跑/游/爬/滑翔），处理模式切换和条件中断
- **行为树（Behavior Tree）**：编排高层任务（如"收集钻石"），分解为子任务序列，处理任务间的优先级抢占和中断恢复
- **条件监控（Condition Monitor）**：持续评估环境条件（饥饿/低血量/敌人/掉落风险），在危险时发出暂停/撤退/重规划信号
- **动作执行（Action Controller）**：将原子动作映射到 Carpet Mod 的 `EntityPlayerActionPack` API 和 Minecraft 原生活动

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **可中断性** | 高优先级链（如MobDefenseChain）可随时打断低优先级链（如UserTaskChain） |
| **可组合性** | Task 可嵌套组合，子任务可复用 |
| **安全性** | 环境监控实时检测危险，自动触发保护行为 |
| **可扩展性** | 新增工具只需实现对应 Task，无需修改框架 |
| **与BE对等** | 行为树模型与 BE 的 ConditionMonitor 模式对齐，状态机扩展为更丰富的模式集 |

### 1.3 参考项目设计要点

| 项目 | 可复用的设计 | 需改造的差异 |
|------|-------------|-------------|
| **altoclef** (Task/Chain/Runner) | Task 抽象（onStart/onTick/onStop）、SingleTaskChain 优先级抢占、EventBus 解耦、BotBehaviour 栈式状态管理 | 没有显式的行为树，而是链式优先级；Task 通过 `isEqual` 做去重而非树节点 |
| **BE adapter-bedrock** (StateMachine/Executor) | MovementStateMachine 状态转换表、ConditionMonitor 条件评估、ActionController 动作封装 | 缺少 Task 编排层，代码耦合在 executor 中 |
| **altoclef trackers** | ItemStorageTracker、EntityTracker、BlockTracker 的追踪模式 | 需适配到 Carpet 假人环境 |

---

## 第2章 系统架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         工具层 (Tool Layer)                        │
│  move_to / mine_block / place_block / eat / sleep / interact...  │
└──────────────┬───────────────────────────────────┬────────────────┘
               │                                   │
               ▼                                   ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│      行为树引擎 (BehaviorTree) │  │     条件监控 (ConditionMonitor) │
│                              │  │                              │
│  TaskRunner ──▶ TaskChain ──▶ Task  │  LowHealth / Hunger /     │
│                              │  │  EnemyDetected / FallRisk   │
│  ┌────────────────────────┐  │  │                              │
│  │  UserTaskChain (P=50)  │  │  │  ▶ 发出: pause/stop/replan   │
│  │  MobDefenseChain(P=70) │  │  │                              │
│  │  FoodChain (P=55)      │  │  └──────────────────────────────┘
│  │  WorldSurvivalChain    │  │               │
│  │  (P=100 lava, P=90 fire)│  │               │
│  └────────────────────────┘  │               │
└──────────────┬───────────────┘               │
               │                                │
               ▼                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      状态机引擎 (StateMachine)                      │
│                                                                   │
│  MovementStateMachine ────▶ MovementExecutor ────▶ ActionController│
│  (walk/sprint/swim/climb/   (沿路径执行段)          (Carpet API)  │
│   elytra/ride/break/place)                                        │
└──────────────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Carpet Mod 动作层 (ActionPack)                   │
│  EntityPlayerActionPack.start() / .stop() / 输入原语控制           │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 三大核心设计模式

#### 模式一：Task 复合模式（从 altoclef 移植）

```
Task (抽象基类)
├── onStart()      — 初始化资源, 注册 tracker, push behaviour
├── onTick()       — 返回子 Task 或 null（表示完成）
│   └── 返回的子 Task 会被自动 tick 直到完成或被替换
├── onStop()       — 清理资源, pop behaviour
├── isFinished()   — 完成判断
├── isEqual()      — 去重判断（防止同一 Task 被重复创建）
└── reset()        — 复位（被中断后下次 tick 重新 onStart）
```

**Task 的生命周期**：
```
[首次 tick] ──▶ onStart() ──▶ onTick() ──▶ [返回子Task] ──▶ 子Task.tick()
                  │                            │
                  │                            └── [返回 null] ──▶ 检查 isFinished()
                  │                                              │
                  └── [中断] ──▶ onStop() ──▶ reset() ──▶ [等待重新调度]
```

**关键接口**（参考 altoclef `Task.java`）：
```java
public abstract class Task {
    // 生命周期
    protected abstract void onStart(AltoClef mod);
    protected abstract Task onTick(AltoClef mod);
    protected abstract void onStop(AltoClef mod, Task interruptTask);

    // 状态查询
    public abstract boolean isFinished(AltoClef mod);
    protected abstract boolean isEqual(Task other);
    protected abstract String toDebugString();

    // 控制
    public void tick(AltoClef mod, TaskChain parentChain);  // 框架调用
    public void stop(AltoClef mod, Task interruptTask);      // 外部中断
    public void interrupt(AltoClef mod, Task interruptTask);  // 临时挂起
    public void reset();                                      // 复位
}
```

#### 模式二：Chain 优先级抢占模式（从 altoclef 移植）

```
TaskRunner
  └── List<TaskChain>
       ├── UserTaskChain       (P=50) — 用户命令
       ├── FoodChain           (P=55) — 自动进食
       ├── MobDefenseChain     (P=70) — 自动防御
       ├── WorldSurvivalChain  (P=100) — 熔岩/火/溺水逃生
       └── MLGBucketFallChain  (P=200) — 水桶落地（最高优先级）

每 tick:
  1. 遍历所有活跃 Chain，取最高优先级
  2. 如果当前 Chain 变化，旧 Chain 的 onInterrupt() 被调用
  3. 最高优先级 Chain 的 tick() 执行
```

**SingleTaskChain 行为**（参考 altoclef `SingleTaskChain.java`）：
```java
public abstract class SingleTaskChain extends TaskChain {
    protected Task _mainTask;

    public void setTask(Task task);  // 替换当前任务（自动 stop 旧任务）
    protected void onTick(AltoClef mod);  // tick _mainTask，完成时调 onTaskFinish
    protected void onTaskFinish(AltoClef mod);  // 子类实现
    public void onInterrupt(AltoClef mod, TaskChain other);  // 被更高优先级抢占
}
```

#### 模式三：状态机 + 条件监控模式（从 BE adapter 移植）

```
MovementStateMachine
  └── state: MoveMode (walk/sprint/swim/climb/elytra/ride/...)
  └── transition(to, ctx) → boolean  // 检查转换表，执行切换

ConditionMonitor
  └── List<IExecutionCondition>
       ├── LowHealthCondition     → health < 6 → 'stop'
       ├── HungerCondition        → food < 6 → 'pause'（触发 FoodChain）
       ├── EnemyDetectedCondition → hostile nearby → 'pause'（触发 MobDefenseChain）
       └── FallRiskCondition      → over void/lava → 'replan'
```

### 2.3 包结构

```
io.alice.mod.adapter.ai
├── behavior/
│   ├── Task.java                  # Task 抽象基类（从 altoclef 移植）
│   ├── TaskChain.java             # TaskChain 抽象基类
│   ├── SingleTaskChain.java       # 单任务链实现
│   ├── TaskRunner.java            # 任务运行器（优先级调度）
│   ├── chain/
│   │   ├── UserTaskChain.java     # 用户任务链
│   │   ├── FoodChain.java         # 自动进食链
│   │   ├── MobDefenseChain.java   # 怪物防御链
│   │   ├── WorldSurvivalChain.java # 世界生存链（熔岩/火/溺水）
│   │   └── MLGBucketFallChain.java # 水桶落地链
│   └── task/
│       ├── movement/
│       │   ├── MoveToTask.java        # 移动到坐标
│       │   ├── FollowEntityTask.java  # 跟随实体
│       │   ├── RideTask.java          # 骑乘
│       │   ├── DismountTask.java      # 脱离
│       │   ├── EscapeFromLavaTask.java # 逃离熔岩
│       │   └── DodgeProjectilesTask.java # 躲避弹射物
│       ├── inventory/
│       │   ├── DropItemTask.java      # 丢弃物品
│       │   ├── TakeFromContainerTask.java # 从容器取物
│       │   ├── PutToContainerTask.java # 向容器放物
│       │   └── EquipItemTask.java     # 装备物品
│       ├── survival/
│       │   ├── EatTask.java           # 进食
│       │   ├── SleepTask.java         # 睡觉
│       │   └── UseItemTask.java       # 使用物品
│       ├── block/
│       │   ├── MineBlockTask.java     # 挖掘方块
│       │   ├── PlaceBlockTask.java    # 放置方块
│       │   ├── UseBlockTask.java      # 使用方块
│       │   └── AreaOperationTask.java # 区域操作
│       ├── combat/
│       │   ├── SetCombatModeTask.java # 设置战斗模式
│       │   └── StopCombatTask.java    # 停止战斗
│       ├── entity/
│       │   ├── InteractEntityTask.java # 实体交互
│       │   └── LeadEntityTask.java    # 拴绳
│       └── misc/
│           ├── IdleTask.java          # 空闲任务
│           └── TimeoutWanderTask.java # 超时游荡
├── state/
│   ├── MovementStateMachine.java  # 移动状态机
│   ├── MovementExecutor.java      # 移动执行器
│   └── ActionController.java      # 动作控制器（Carpet ActionPack封装）
├── condition/
│   ├── ConditionMonitor.java      # 条件监控器
│   ├── IExecutionCondition.java   # 条件接口
│   ├── LowHealthCondition.java    # 低血量条件
│   ├── HungerCondition.java       # 饥饿条件
│   ├── EnemyDetectedCondition.java # 敌人检测条件
│   └── FallRiskCondition.java     # 掉落风险条件
├── tracker/
│   ├── Tracker.java               # 追踪器基类
│   ├── TrackerManager.java        # 追踪器管理器
│   ├── EntityTracker.java         # 实体追踪器
│   ├── BlockTracker.java          # 方块追踪器
│   └── ItemStorageTracker.java    # 物品存储追踪器
├── control/
│   ├── InputControls.java         # 输入控制（按键模拟）
│   ├── KillAura.java              # 自动攻击
│   └── SlotHandler.java           # 物品栏操作
└── event/
    ├── EventBus.java              # 事件总线
    └── events/
        ├── ClientTickEvent.java
        ├── TaskFinishedEvent.java
        └── ChatMessageEvent.java
```

---

## 第3章 状态机设计

### 3.1 状态定义

移动状态机管理假人的移动模式，支持以下状态：

```java
public enum MoveMode {
    WALK,           // 普通行走
    SPRINT,         // 疾跑
    SPRINT_JUMP,    // 疾跑跳跃
    SWIM,           // 游泳
    CLIMB,          // 攀爬（梯子/藤蔓）
    ELYTRA,         // 鞘翅滑翔
    RIDE,           // 骑乘
    BOAT,           // 乘船
    BREAK_BLOCK,    // 破坏方块（原地）
    PLACE_BLOCK     // 放置方块（原地）
}
```

### 3.2 状态转换表

（参考 BE `state-machine.ts` 的转换表）

```
当前状态 → 可转换到
────────┼──────────────────────────────────────────────
WALK      → SPRINT, SPRINT_JUMP, SWIM, CLIMB, ELYTRA, RIDE, BOAT, BREAK, PLACE
SPRINT    → WALK, SPRINT_JUMP, SWIM, CLIMB, ELYTRA, RIDE, BOAT, BREAK, PLACE
SWIM      → WALK, SPRINT, CLIMB, ELYTRA, RIDE, BOAT, BREAK, PLACE
CLIMB     → WALK, SPRINT, SWIM, ELYTRA, RIDE, BOAT, BREAK, PLACE
ELYTRA    → WALK, SPRINT, SWIM, CLIMB, RIDE, BOAT, BREAK, PLACE
RIDE      → WALK, SWIM, CLIMB, ELYTRA, BOAT, BREAK, PLACE
BOAT      → WALK, SWIM, CLIMB, ELYTRA, RIDE, BREAK, PLACE
BREAK     → 所有状态
PLACE     → 所有状态
```

### 3.3 状态机实现

```java
public class MovementStateMachine {
    private MoveMode state = MoveMode.WALK;

    public MoveMode getState() { return state; }

    public boolean transition(MoveMode to, MovementContext ctx) {
        MoveMode[] allowed = TRANSITIONS.get(state);
        if (to == state || (allowed != null && Arrays.asList(allowed).contains(to))) {
            state = to;
            applyState(to, ctx);
            return true;
        }
        return false;
    }

    private void applyState(MoveMode mode, MovementContext ctx) {
        switch (mode) {
            case SPRINT:
                if (ctx.foodLevel >= 6) ctx.actionPack.setSprinting(true);
                break;
            case SWIM:
                ctx.actionPack.setSprinting(false);
                ctx.actionPack.startSwimming();
                break;
            case CLIMB:
                ctx.actionPack.setSprinting(false);
                ctx.actionPack.startClimbing();
                break;
            // ...
        }
    }

    public void reset() { state = MoveMode.WALK; }
}
```

### 3.4 执行器设计

```java
public class MovementExecutor {
    private MovementStateMachine stateMachine = new MovementStateMachine();
    private ConditionMonitor conditionMonitor = new ConditionMonitor();
    private ActionController actionController;
    private BlockInteractionExecutor blockInteractionExecutor;
    private boolean stopped = false;
    private boolean paused = false;

    /** 执行路径，返回移动结果 */
    public MoveResult execute(Path path, MovementContext ctx) {
        actionController = new ActionController(ctx.bot);
        stateMachine.reset();

        for (PathSegment segment : path.segments()) {
            if (stopped) return result("cancelled");
            while (paused) sleep(50);

            // 条件检查
            ConditionSignal signal = conditionMonitor.evaluate(ctx);
            if (signal == STOP) return result("interrupted");
            if (signal == PAUSE) { paused = true; continue; }

            // 状态切换
            stateMachine.transition(segment.mode(), ctx);

            // 执行段
            SegmentResult segResult = executeSegment(segment, ctx);
            if (!segResult.success()) return result(segResult.reason());
        }
        return result("success");
    }

    private SegmentResult executeSegment(PathSegment segment, MovementContext ctx) {
        ActionController ac = actionController;

        switch (segment.mode()) {
            case WALK, SPRINT, SPRINT_JUMP, SWIM, CLIMB:
                for (Waypoint wp : segment.waypoints()) {
                    ConditionSignal signal = conditionMonitor.evaluate(ctx);
                    if (signal != CONTINUE) return fail(signal.name());

                    ac.lookAt(wp);
                    applyMovementMode(segment.mode(), ac, ctx);

                    boolean arrived = waitForPosition(wp, ctx, ac, 0.8, 10000);
                    if (!arrived) return fail("blocked");
                }
                break;

            case BREAK_BLOCK, PLACE_BLOCK:
                // 调用 blockInteractionExecutor
                break;
        }
        return ok();
    }
}
```

---

## 第4章 行为树设计

### 4.1 行为树 vs 链式优先级

行为树本质上是一个**树形任务编排结构**，但我们在 JE 中采用**简化版的行为树模型**：

- **组合节点** → `TaskChain`（顺序执行子任务）
- **条件节点** → `ConditionMonitor`（评估环境条件）
- **动作节点** → `Task`（原子操作）
- **装饰节点** → `SingleTaskChain`（带优先级的中断管理）

### 4.2 任务调度流程

```
每 ClientTick:
  1. TaskRunner.tick()
     └── 遍历所有 TaskChain，选最高优先级
         └── 如果当前 Chain 变化，通知旧 Chain.onInterrupt()
             └── 旧 Chain 的 Task 被 interrupt() 挂起
         └── 最高优先级 Chain.onTick()
             └── Task.onTick() → 返回子 Task
                 └── 子 Task.onTick() → ... 递归
```

### 4.3 任务类别

| 类别 | 基类 | 说明 |
|------|------|------|
| **移动任务** | `MoveToTask extends Task` | 移动到坐标/实体/方块 |
| **背包任务** | `InventoryTask extends Task` | 丢物/取物/放物/装备 |
| **生存任务** | `SurvivalTask extends Task` | 吃/睡/使用物品 |
| **方块任务** | `BlockTask extends Task` | 挖掘/放置/使用/区域操作 |
| **战斗任务** | `CombatTask extends Task` | 战斗模式切换/停止 |
| **实体任务** | `EntityTask extends Task` | 喂食/繁殖/交易/驯服/剪毛/挤奶/拴绳 |
| **资源任务** | `ResourceTask extends Task` | 资源收集（从 altoclef 移植） |

### 4.4 Chain 优先级定义

| Chain | 优先级 | 条件 | 说明 |
|-------|:------:|------|------|
| `MLGBucketFallChain` | 200 | 玩家正在坠落至虚空 | 最高优先级，救命 |
| `WorldSurvivalChain` | 100 | inLava / inFire | 熔岩/火中逃生 |
| `MobDefenseChain` | 70 | hostile nearby / being shot | 怪物防御/躲避 |
| `FoodChain` | 55 | foodLevel < ALWAYS_EAT | 自动进食 |
| `UserTaskChain` | 50 | 用户下达命令 | 常规任务执行 |
| `WorldSurvivalChain` (portal) | 60 | stuck in portal | 传送门卡住自救 |

### 4.5 任务示例

**MoveToTask**（参考 altoclef `GetToBlockTask.java`）：

```java
public class MoveToTask extends Task {
    private final Vec3 target;
    private final double stopDistance;
    private final boolean sprint;

    @Override
    protected void onStart(AltoClef mod) {
        // 初始化寻路
        Path path = pathfinder.findPath(bot.position(), target, ctx);
        executor.execute(path, ctx);
    }

    @Override
    protected Task onTick(AltoClef mod) {
        if (executor.isFinished()) return null;  // 完成
        if (conditionMonitor.evaluate(ctx) != CONTINUE) return null; // 中断
        executor.continueTick();
        return null;  // 自身是叶子节点，不返回子 Task
    }

    @Override
    protected void onStop(AltoClef mod, Task interruptTask) {
        executor.stop();
    }

    @Override
    public boolean isFinished(AltoClef mod) {
        return bot.position().distanceTo(target) <= stopDistance;
    }

    @Override
    protected boolean isEqual(Task other) {
        return other instanceof MoveToTask t && t.target.equals(target);
    }
}
```

**EatTask**（参考 altoclef `FoodChain.java`）：

```java
public class EatTask extends Task {
    @Override
    protected void onStart(AltoClef mod) {
        ItemStack bestFood = findBestFood(bot);
        slotHandler.forceEquipItem(bestFood);
        inputControls.hold(Input.CLICK_RIGHT);
    }

    @Override
    protected Task onTick(AltoClef mod) {
        if (bot.getFoodData().getFoodLevel() >= 20) return null;
        return null;  // 持续进食
    }

    @Override
    protected void onStop(AltoClef mod, Task interruptTask) {
        inputControls.release(Input.CLICK_RIGHT);
    }

    @Override
    public boolean isFinished(AltoClef mod) {
        return bot.getFoodData().getFoodLevel() >= 20;
    }
}
```

---

## 第5章 条件监控设计

### 5.1 条件接口

```java
public interface IExecutionCondition {
    /**
     * 评估条件，返回控制信号
     * @param ctx 当前上下文（bot状态、位置、环境）
     * @return CONTINUE: 继续执行
     *         PAUSE:   暂停当前任务（触发高优先级 Chain）
     *         STOP:    停止当前任务（失败）
     *         REPLAN:  触发重规划
     */
    ConditionSignal evaluate(ExecutionConditionContext ctx);
}
```

### 5.2 条件实现

**LowHealthCondition**（参考 BE `low-health.ts`）：

```java
public class LowHealthCondition implements IExecutionCondition {
    @Override
    public ConditionSignal evaluate(ExecutionConditionContext ctx) {
        float health = ctx.bot.getHealth();
        if (health <= 0) return STOP;
        if (health < 6) return STOP;  // 必须立即撤退
        if (health < 10 && ctx.nearbyHostiles()) return PAUSE;
        return CONTINUE;
    }
}
```

**HungerCondition**（参考 BE `hunger.ts`）：

```java
public class HungerCondition implements IExecutionCondition {
    @Override
    public ConditionSignal evaluate(ExecutionConditionContext ctx) {
        int foodLevel = ctx.bot.getFoodData().getFoodLevel();
        if (foodLevel <= 0) return STOP;
        if (foodLevel < 6) return PAUSE;  // 触发 FoodChain
        return CONTINUE;
    }
}
```

**EnemyDetectedCondition**（参考 BE `enemy-detected.ts`）：

```java
public class EnemyDetectedCondition implements IExecutionCondition {
    @Override
    public ConditionSignal evaluate(ExecutionConditionContext ctx) {
        if (!ctx.trackerManager.getEntityTracker().hasHostiles()) return CONTINUE;
        if (ctx.bot.getHealth() < 10) return STOP;
        if (isCreeperAboutToExplode(ctx)) return STOP;
        if (isBeingShot(ctx)) return PAUSE;
        return CONTINUE;
    }
}
```

### 5.3 条件监控器

```java
public class ConditionMonitor {
    private List<IExecutionCondition> conditions = List.of(
        new LowHealthCondition(),
        new HungerCondition(),
        new EnemyDetectedCondition(),
        new FallRiskCondition()
    );

    public ConditionSignal evaluate(ExecutionConditionContext ctx) {
        for (IExecutionCondition condition : conditions) {
            ConditionSignal signal = condition.evaluate(ctx);
            if (signal != CONTINUE) return signal;
        }
        return CONTINUE;
    }
}
```

---

## 第6章 动作控制器设计

### 6.1 Carpet ActionPack 封装

```java
public class ActionController {
    private final EntityPlayerMPFake bot;
    private final EntityPlayerActionPack actionPack;

    public ActionController(EntityPlayerMPFake bot) {
        this.bot = bot;
        this.actionPack = bot.getActionPack();
    }

    /** 移动到指定位置（使用 Carpet ActionPack） */
    public boolean moveTo(Vec3 target, double speed) {
        actionPack.start(EntityPlayerActionPack.ActionType.MOVE_TO,
            new BlockPos((int)target.x, (int)target.y, (int)target.z), speed);
        return true;
    }

    /** 看向目标 */
    public void lookAt(Vec3 target) {
        actionPack.lookAt(target);
    }

    /** 设置疾跑 */
    public void setSprint(boolean sprint) {
        actionPack.setSprinting(sprint);
    }

    /** 跳跃 */
    public void jump() {
        actionPack.start(EntityPlayerActionPack.ActionType.JUMP, null, 1);
    }

    /** 攻击 */
    public void attack(Entity target) {
        actionPack.attack(target);
    }

    /** 使用物品（右键） */
    public void useItem() {
        actionPack.start(EntityPlayerActionPack.ActionType.USE, null, 1);
    }

    /** 停止所有动作 */
    public void stopAll() {
        actionPack.stopAll();
    }

    /** 破坏方块 */
    public boolean breakBlock(BlockPos pos) {
        bot.connection.send(new ServerboundPlayerActionPacket(
            Action.START_DESTROY_BLOCK, pos, Direction.UP, 0));
        return true;
    }

    /** 放置方块 */
    public boolean placeBlock(BlockPos pos, Direction face) {
        // 使用 InteractionManager
        return bot.gameMode.useItemOn(bot, bot.getMainHandItem(),
            new BlockHitResult(Vec3.atCenterOf(pos), face, pos, false));
    }
}
```

### 6.2 输入控制（按键模拟）

参考 altoclef `InputControls.java` + `KillAura.java`：

```java
public class InputControls {
    private final Map<Input, Boolean> heldKeys = new HashMap<>();

    public void hold(Input key) {
        heldKeys.put(key, true);
        applyKey(key, true);
    }

    public void release(Input key) {
        heldKeys.put(key, false);
        applyKey(key, false);
    }

    public void press(Input key) {
        hold(key);
        // 下一 tick 自动释放
    }

    private void applyKey(Input key, boolean pressed) {
        // 通过 Carpet ActionPack 或直接 Minecraft 按键绑定
        KeyBinding keyBinding = getKeyBinding(key);
        keyBinding.setDown(pressed);
        KeyBinding.onTick(keyBinding.getDefaultKey());
    }
}
```

---

## 第7章 追踪器设计

### 7.1 追踪器基类

（参考 altoclef `Tracker.java` + `TrackerManager.java`）

```java
public abstract class Tracker {
    protected AltoClef mod;

    public abstract void setDirty();   // 标记为脏数据，下次访问时刷新
    public abstract void reset();      // 重置（离开世界时调用）
}
```

### 7.2 实体追踪器

```java
public class EntityTracker extends Tracker {
    private List<Entity> trackedEntities = new ArrayList<>();
    private List<Entity> hostiles = new ArrayList<>();
    private List<CachedProjectile> projectiles = new ArrayList<>();

    public void tick() {
        // 每 tick 从世界获取实体列表
        ServerLevel level = (ServerLevel) bot.level();
        trackedEntities = level.getAllEntities();
        // 分类
        hostiles = trackedEntities.stream()
            .filter(e -> e instanceof Monster && isAngryAtPlayer(e))
            .collect(Collectors.toList());
        projectiles = trackedEntities.stream()
            .filter(e -> e instanceof Projectile)
            .map(CachedProjectile::from)
            .collect(Collectors.toList());
    }

    public <T extends Entity> List<T> getTrackedEntities(Class<T> type) { ... }
    public Optional<Entity> getClosestEntity(Vec3 pos, Class<?>... types) { ... }
    public boolean hasHostiles() { return !hostiles.isEmpty(); }
}
```

### 7.3 方块追踪器

```java
public class BlockTracker extends Tracker {
    private Set<Block> trackingBlocks = new HashSet<>();
    private Map<BlockPos, BlockState> foundBlocks = new HashMap<>();

    public void trackBlock(Block... blocks) {
        Collections.addAll(trackingBlocks, blocks);
    }

    public void stopTracking(Block... blocks) {
        trackingBlocks.removeAll(Arrays.asList(blocks));
    }

    public Optional<BlockPos> getNearestTracking(Vec3 pos, Block... blocks) {
        // 扫描周围 chunk 中匹配的方块，返回最近者
    }

    public boolean blockIsValid(BlockPos pos, Block... blocks) {
        BlockState state = bot.level().getBlockState(pos);
        return Arrays.asList(blocks).contains(state.getBlock());
    }
}
```

### 7.4 物品存储追踪器

```java
public class ItemStorageTracker extends Tracker {
    private Map<Item, Integer> inventoryCache = new HashMap<>();
    private List<ContainerCache> containerCache = new ArrayList<>();

    public void refresh() {
        // 重建背包缓存
        inventoryCache.clear();
        for (int i = 0; i < bot.getInventory().getContainerSize(); i++) {
            ItemStack stack = bot.getInventory().getItem(i);
            if (!stack.isEmpty()) {
                inventoryCache.merge(stack.getItem(), stack.getCount(), Integer::sum);
            }
        }
    }

    public boolean hasItem(Item item) {
        return inventoryCache.getOrDefault(item, 0) > 0;
    }

    public int getItemCount(Item item) {
        return inventoryCache.getOrDefault(item, 0);
    }

    public boolean hasItem(Item item, int minCount) {
        return getItemCount(item) >= minCount;
    }
}
```

---

## 第8章 事件总线设计

（参考 altoclef `EventBus.java`）

```java
public class EventBus {
    private static final Map<Class<?>, List<Consumer<?>>> subscribers = new HashMap<>();

    public static <T> void subscribe(Class<T> eventType, Consumer<T> handler) {
        subscribers.computeIfAbsent(eventType, k -> new ArrayList<>()).add(handler);
    }

    public static <T> void publish(T event) {
        List<Consumer<?>> handlers = subscribers.get(event.getClass());
        if (handlers != null) {
            handlers.forEach(h -> ((Consumer<T>) h).accept(event));
        }
    }
}
```

**事件类型**：

```java
public class ClientTickEvent { }                          // 每 client tick 触发
public class TaskFinishedEvent {                          // 任务完成
    private final double durationSeconds;
    private final Task task;
}
public class ChatMessageEvent {                           // 聊天消息
    private final Component message;
}
public class BotDeathEvent {                              // 假人死亡
    private final String name;
    private final UUID uuid;
    private final String deathMessage;
}
```

---

## 第9章 开发实施计划

### 9.1 阶段划分

```
Phase 1: 基础框架 (5天)
  ├── Task / TaskChain / TaskRunner / SingleTaskChain 移植
  ├── EventBus 移植
  ├── ConditionMonitor 实现
  └── ActionController 封装（Carpet ActionPack）

Phase 2: 移动系统 (5天)
  ├── MovementStateMachine 实现
  ├── MovementExecutor 实现
  ├── MoveToTask / FollowEntityTask
  └── RideTask / DismountTask

Phase 3: Chain 系统 (3天)
  ├── UserTaskChain
  ├── FoodChain（自动进食）
  ├── MobDefenseChain（自动防御）
  ├── WorldSurvivalChain（熔岩/火/溺水）
  └── MLGBucketFallChain（水桶落地）

Phase 4: 追踪器 (3天)
  ├── EntityTracker
  ├── BlockTracker
  ├── ItemStorageTracker
  └── TrackerManager

Phase 5: 任务实现 (10天)
  ├── InventoryTask → DropItemTask / ContainerTask / EquipItemTask
  ├── SurvivalTask → EatTask / SleepTask / UseItemTask
  ├── BlockTask → MineBlockTask / PlaceBlockTask / UseBlockTask / AreaOperationTask
  ├── CombatTask → SetCombatModeTask / StopCombatTask
  └── EntityTask → InteractEntityTask / LeadEntityTask
```

### 9.2 代码复用对照表

| JE 模块 | 可复用的参考代码 | 路径 |
|---------|----------------|------|
| Task.java | altoclef `Task.java` | `libs/altoclef/src/.../tasksystem/Task.java` |
| TaskChain.java | altoclef `TaskChain.java` | `libs/altoclef/src/.../tasksystem/TaskChain.java` |
| SingleTaskChain.java | altoclef `SingleTaskChain.java` | `libs/altoclef/src/.../chains/SingleTaskChain.java` |
| TaskRunner.java | altoclef `TaskRunner.java` | `libs/altoclef/src/.../tasksystem/TaskRunner.java` |
| EventBus.java | altoclef `EventBus.java` | `libs/altoclef/src/.../eventbus/EventBus.java` |
| MovementStateMachine | BE `state-machine.ts` | `packages/adapter-bedrock/src/ai/movement/state-machine.ts` |
| ConditionMonitor | BE `condition-monitor.ts` | `packages/adapter-bedrock/src/ai/movement/condition-monitor.ts` |
| ActionController | BE `action-controller.ts` | `packages/adapter-bedrock/src/ai/movement/action-controller.ts` |
| FoodChain | altoclef `FoodChain.java` | `libs/altoclef/src/.../chains/FoodChain.java` |
| MobDefenseChain | altoclef `MobDefenseChain.java` | `libs/altoclef/src/.../chains/MobDefenseChain.java` |
| WorldSurvivalChain | altoclef `WorldSurvivalChain.java` | `libs/altoclef/src/.../chains/WorldSurvivalChain.java` |
| EntityTracker | altoclef `EntityTracker.java` | `libs/altoclef/src/.../trackers/EntityTracker.java` |
| BlockTracker | altoclef `BlockTracker.java` | `libs/altoclef/src/.../trackers/BlockTracker.java` |
| ItemStorageTracker | altoclef `ItemStorageTracker.java` | `libs/altoclef/src/.../trackers/storage/ItemStorageTracker.java` |
| BotBehaviour | altoclef `BotBehaviour.java` | `libs/altoclef/src/.../BotBehaviour.java` |
| InputControls | altoclef `InputControls.java` | `libs/altoclef/src/.../control/InputControls.java` |
| KillAura | altoclef `KillAura.java` | `libs/altoclef/src/.../control/KillAura.java` |
| SlotHandler | altoclef `SlotHandler.java` | `libs/altoclef/src/.../control/SlotHandler.java` |
| ResourceTask | altoclef `ResourceTask.java` | `libs/altoclef/src/.../tasks/ResourceTask.java` |

### 9.3 与现有控制器的集成

现有 `MovementController` / `SurvivalController` / `InventoryController` 等是**简单占位实现**（基于 teleport），需要在 Phase 2-5 中逐步替换为**基于 Task 系统的实现**。

**集成策略**：
1. 保持现有 Controller 的工具接口不变（工具层仍调用 `MovementController.moveTo()`）
2. 在 Controller 内部，将工具调用转为 Task 系统的调用
3. 逐步替换实现，每个工具替换后验证

```java
// 改造后：工具层 → Controller → Task 系统
public class MoveToTools {
    @ToolMethod(name = "move_to", description = "移动到目标位置")
    public ToolResult execute(Map<String, Object> args) {
        // 1. 解析参数
        double x = (double) args.get("x");
        double y = (double) args.get("y");
        double z = (double) args.get("z");

        // 2. 创建 Task 并提交到 TaskRunner
        MoveToTask task = new MoveToTask(new Vec3(x, y, z));
        botAccess.getTaskRunner().getUserTaskChain().setTask(task);

        // 3. 等待完成（或超时）
        return waitForTask(task);
    }
}
```

### 9.4 与 BotManager 的集成

`BotManager` 提供假人生命周期管理。执行AI 引擎需要能够访问当前假人：

```java
// 在 AI 初始化时
public class AliceModServer {
    public void onServerStarted(MinecraftServer server) {
        BotManager botManager = worldContext.getBotManager();
        TaskRunner taskRunner = new TaskRunner(botManager);
        // 注册所有 Chain
        new UserTaskChain(taskRunner);
        new FoodChain(taskRunner);
        new MobDefenseChain(taskRunner);
        new WorldSurvivalChain(taskRunner);
        // 启动 tick 驱动
        ServerLifecycleEvents.SERVER_TICK.register(() -> taskRunner.tick());
    }
}
```

---

## 第10章 测试计划

### 10.1 单元测试

| 测试项 | 用例 | 预期 |
|--------|------|------|
| Task 生命周期 | 创建→tick→完成 | onStart→onTick→完成→onStop 按序调用 |
| Task 中断 | 运行中调 stop() | onStop 被调用，reset() 后可重新启动 |
| SingleTaskChain 切换 | setTask(newTask) | 旧任务 stop，新任务 start |
| TaskRunner 优先级 | 注册两个 Chain，激活高优先级 | 高优先级任务执行，低优先级被中断 |
| MovementStateMachine 转换 | walk→sprint→swim | 允许的转换成功，不允许的失败 |
| ConditionMonitor | 设置低血量条件 | 血量 < 6 返回 STOP |

### 10.2 集成测试

| 测试场景 | 测试步骤 | 预期 |
|---------|---------|------|
| 移动工具 | 调用 move_to | 假人移动到目标位置 |
| 自动进食 | 饥饿值 < 6 | FoodChain 自动触发，假人进食 |
| 熔岩逃生 | 假人掉入熔岩 | WorldSurvivalChain 触发，逃离熔岩 |
| 怪物防御 | 僵尸靠近 | MobDefenseChain 触发，攻击或逃跑 |
| 任务中断恢复 | 移动中被怪物打断 | 怪物解决后，移动任务自动恢复 |

---

## 附录A：关键类签名

```java
// === Task 系统 ===
public abstract class Task {
    protected abstract void onStart(AltoClef mod);
    protected abstract Task onTick(AltoClef mod);
    protected abstract void onStop(AltoClef mod, Task interruptTask);
    public abstract boolean isFinished(AltoClef mod);
    protected abstract boolean isEqual(Task other);
    protected abstract String toDebugString();
    public void tick(AltoClef mod, TaskChain parentChain);
    public void stop(AltoClef mod, Task interruptTask);
    public void reset();
}

// === TaskChain ===
public abstract class TaskChain {
    public TaskChain(TaskRunner runner);
    public abstract float getPriority(AltoClef mod);
    public abstract boolean isActive();
    public abstract String getName();
    public abstract void onInterrupt(AltoClef mod, TaskChain other);
    public void tick(AltoClef mod);
    public void stop(AltoClef mod);
}

// === SingleTaskChain ===
public abstract class SingleTaskChain extends TaskChain {
    public void setTask(Task task);
    protected abstract void onTaskFinish(AltoClef mod);
}

// === TaskRunner ===
public class TaskRunner {
    public void tick();
    public void addTaskChain(TaskChain chain);
    public void enable();
    public void disable();
}

// === 状态机 ===
public class MovementStateMachine {
    public MoveMode getState();
    public boolean transition(MoveMode to, MovementContext ctx);
    public void reset();
}

// === 条件监控 ===
public interface IExecutionCondition {
    ConditionSignal evaluate(ExecutionConditionContext ctx);
}
public class ConditionMonitor {
    public ConditionSignal evaluate(ExecutionConditionContext ctx);
}

// === 动作控制器 ===
public class ActionController {
    public boolean moveTo(Vec3 target, double speed);
    public void lookAt(Vec3 target);
    public void setSprint(boolean sprint);
    public void attack(Entity target);
    public boolean breakBlock(BlockPos pos);
    public boolean placeBlock(BlockPos pos, Direction face);
    public void stopAll();
}

// === 追踪器 ===
public class TrackerManager {
    public void tick();
    public void addTracker(Tracker tracker);
}
public abstract class Tracker {
    public abstract void setDirty();
    public abstract void reset();
}
```

## 附录B：文件结构

```
src/main/java/io/alice/mod/adapter/ai/
├── behavior/
│   ├── Task.java
│   ├── TaskChain.java
│   ├── SingleTaskChain.java
│   ├── TaskRunner.java
│   ├── chain/
│   │   ├── UserTaskChain.java
│   │   ├── FoodChain.java
│   │   ├── MobDefenseChain.java
│   │   ├── WorldSurvivalChain.java
│   │   └── MLGBucketFallChain.java
│   └── task/
│       ├── movement/
│       │   ├── MoveToTask.java
│       │   ├── FollowEntityTask.java
│       │   ├── RideTask.java
│       │   └── DismountTask.java
│       ├── inventory/
│       │   ├── DropItemTask.java
│       │   ├── TakeFromContainerTask.java
│       │   ├── PutToContainerTask.java
│       │   └── EquipItemTask.java
│       ├── survival/
│       │   ├── EatTask.java
│       │   ├── SleepTask.java
│       │   └── UseItemTask.java
│       ├── block/
│       │   ├── MineBlockTask.java
│       │   ├── PlaceBlockTask.java
│       │   ├── UseBlockTask.java
│       │   └── AreaOperationTask.java
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
│   ├── MovementStateMachine.java
│   ├── MovementExecutor.java
│   └── ActionController.java
├── condition/
│   ├── ConditionMonitor.java
│   ├── IExecutionCondition.java
│   ├── LowHealthCondition.java
│   ├── HungerCondition.java
│   ├── EnemyDetectedCondition.java
│   └── FallRiskCondition.java
├── tracker/
│   ├── Tracker.java
│   ├── TrackerManager.java
│   ├── EntityTracker.java
│   ├── BlockTracker.java
│   └── ItemStorageTracker.java
├── control/
│   ├── InputControls.java
│   ├── KillAura.java
│   └── SlotHandler.java
└── event/
    ├── EventBus.java
    └── events/
        ├── ClientTickEvent.java
        ├── TaskFinishedEvent.java
        └── ChatMessageEvent.java
```