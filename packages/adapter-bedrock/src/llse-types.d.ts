// LeviLamina LLSE API 类型声明

// ============================================================
// 坐标类型
// ============================================================

declare class FloatPos {
  x: number;
  y: number;
  z: number;
  dim: number;
  dimid: number;
  type: 'floatpos';
  constructor(x: number, y: number, z: number, dimid: number);
}

declare class IntPos {
  x: number;
  y: number;
  z: number;
  dim: number;
  dimid: number;
  type: 'intpos';
}

// ============================================================
// NBT API
// ============================================================

declare class NbtCompound {
  setTag(name: string, tag: NbtTag): this;
  getTag(name: string): NbtTag;
  removeTag(name: string): this;
  toSNBT(): string;
  destroy(): void;
}

declare class NbtTag {}
declare namespace NBT {
  function parseSNBT(snbt: string): NbtCompound | null;
  function createTag(type: string): NbtTag;
}

// ============================================================
// LLSE File API
// ============================================================

declare namespace File {
  function readFrom(path: string): string;
  function writeTo(path: string, content: string): boolean;
  function exists(path: string): boolean;
  function mkdir(path: string): boolean;
  function deleteFile(path: string): boolean;
  function getFilesList(path: string): string[];
  function checkIsDir(path: string): boolean;
}

// ============================================================
// JsonConfigFile API
// ============================================================

declare class JsonConfigFile {
  constructor(path: string);
  init(name: string, defaultValue: any): void;
  get(name: string, defaultValue?: any): any;
  set(name: string, value: any): void;
  delete(name: string): void;
}

// ============================================================
// mc 全局 API
// ============================================================

declare namespace mc {
  function listen(event: string, callback: (...args: any[]) => boolean | void): boolean;
  function regPlayerCmd(cmd: string, description: string, callback: (player: Player, args: string[]) => void, level?: number): boolean;

  function getPlayer(name: string): Player | null;
  function getAllPlayers(): Player[];
  function getOnlinePlayers(): Player[];
  function broadcast(msg: string, type?: number): void;
  function runCmd(cmd: string): number;
  function getBDSVersion(): string;

  function spawnSimulatedPlayer(name: string, pos: FloatPos): Player | null;

  function newItem(name: string, count: number, extra?: any): Item | null;
  function spawnItem(item: Item, pos: FloatPos): Entity | null;
  function spawnEntity(type: string, count: number, pos: IntPos | FloatPos): Entity | null;

  function getBlock(pos: IntPos): Block;
  function getBlock(x: number, y: number, z: number, dimid: number): Block;
  function explode(pos: FloatPos | IntPos, radius: number, fire: boolean, destroy: boolean): boolean;
  function rand(min: number, max: number): number;

  function getTime(): number;
  function getTimeOfDay(): number;
  function getDay(): number;
  function setTime(time: number): void;
  function getWeather(): 'clear' | 'rain' | 'thunder';
  function setWeather(weather: 'clear' | 'rain' | 'thunder'): void;
  function isRaining(): boolean;
  function isThundering(): boolean;
  function getServerProtocolVersion(): number;
  function getServerIp(): string;
  function getServerPort(): number;

  // Command API (new)
  function newCommand(
    name: string,
    description: string,
    permission: number,
    flag: number,
  ): Command;

  // GUI — SimpleForm
  function newSimpleForm(): SimpleForm;
  function newCustomForm(): CustomForm;
}

// ============================================================
// PermType
// ============================================================

declare namespace PermType {
  const Any: number;
  const GameMasters: number;
  const Admin: number;
  const Console: number;
}

// ============================================================
// Command API
// ============================================================

declare class Command {
  setEnum(name: string, values: string[]): this;
  mandatory(
    name: string,
    type: number,
    enumName?: string,
    identifier?: string,
    option?: number,
  ): this;
  optional(
    name: string,
    type: number,
    enumName?: string,
    identifier?: string,
    option?: number,
  ): this;
  overload(params: string[]): this;
  setCallback(
    callback: (cmd: Command, origin: CommandOrigin, output: CommandOutput, result: any) => void,
  ): this;
  setup(): boolean;
}

declare namespace ParamType {
  const Bool: number;
  const Int: number;
  const Float: number;
  const String: number;
  const Player: number;
  const Target: number;
  const Vec3: number;
  const Enum: number;
  const SoftEnum: number;
  const RawText: number;
  const Message: number;
  const JsonValue: number;
  const Item: number;
  const Block: number;
  const Effect: number;
  const Container: number;
}

interface CommandOrigin {
  type: number;
  player: Player | null;
}

interface CommandOutput {
  success(msg: string): void;
  error(msg: string): void;
  addMessage(msg: string): void;
}

// ============================================================
// SimpleForm API
// ============================================================

declare class SimpleForm {
  setTitle(title: string): this;
  setContent(content: string): this;
  addButton(text: string, icon?: string): this;
  sendTo(player: Player, callback: (player: Player, id: number | null) => void): void;
}

declare class CustomForm {
  setTitle(title: string): this;
  addLabel(text: string): this;
  addInput(title: string, placeholder: string, def?: string): this;
  addSwitch(title: string, def?: boolean): this;
  addDropdown(title: string, items: string[], def?: number): this;
  addSlider(title: string, min: number, max: number, step?: number, def?: number): this;
  addStepSlider(title: string, items: string[], def?: number): this;
  sendTo(player: Player, callback: (player: Player, data: any) => void): void;
}

// ============================================================
// ll 全局 API
// ============================================================

declare namespace ll {
  function registerPlugin(name: string, desc: string, version: [number, number, number], ...other: any[]): boolean;
  function requireVersion(major: number, minor?: number, patch?: number): boolean;
  function hasPlugin(name: string): boolean;
  function listPlugins(): Array<{ name: string; version: string; type: string }>;
  function exportFunc(func: (...args: any[]) => any, name: string): void;
  function importFunc(name: string): (...args: any[]) => any;
  function eval(str: string): any;
}

// ============================================================
// logger 全局 API
// ============================================================

declare namespace logger {
  function setTitle(title: string): void;
  function setConsole(enable: boolean, level?: number): void;
  function setFile(enable: boolean, level?: number): void;
  function log(...args: any[]): void;
  function info(...args: any[]): void;
  function warn(...args: any[]): void;
  function error(...args: any[]): void;
  function debug(...args: any[]): void;
}

// ============================================================
// Player 接口（完整版）
// ============================================================

interface Player {
  name: string;
  xuid: string;
  uuid: string;
  realName: string;
  permLevel: number;
  ip: string;
  onlineTime: number;
  pos: FloatPos;
  direction: { yaw: number; pitch: number };
  gameMode: number;
  health: number;
  maxHealth: number;
  hunger: number;
  saturation: number;
  feetPos: FloatPos;

  // 常规方法
  getPos(): FloatPos;
  teleport(pos: FloatPos | IntPos, dimId?: number): boolean;
  sendText(msg: string, type?: number): boolean;
  runCmd(cmd: string): boolean;
  isOP(): boolean;
  setOP(isOP: boolean): boolean;
  kick(reason: string): boolean;
  getHealth(): number;
  setHealth(health: number): boolean;
  getMaxHealth(): number;
  getHunger(): number;
  setHunger(hunger: number): boolean;
  getSaturation(): number;
  setSaturation(saturation: number): boolean;
  getLevel(): number;
  setLevel(level: number): boolean;
  getTotalExperience(): number;
  getGameMode(): number;
  setGameMode(mode: number): boolean;
  refreshInventory(): boolean;

  // GUI
  sendForm(form: SimpleForm, callback: (player: Player, id: number | null) => void): void;

  // 模拟玩家（SimulatedPlayer）方法
  isSimulatedPlayer(): boolean;
  simulateDisconnect(): boolean;
  simulateSetBodyRotation(yaw: number): boolean;
  simulateAttack(): boolean;
  simulateDestroy(): boolean;
  simulateInteract(): boolean;
  simulateUseItem(): boolean;
  simulateStopUsingItem(): boolean;
  simulateStopDestroyingBlock(): boolean;
  simulateStopInteracting(): boolean;
  simulateMoveTo(pos: FloatPos): any;
  simulateStopMoving(): boolean;
  simulateNavigateTo(pos: any): any;
  simulateLookAt(target: any): boolean;

  // 骑乘
  isRiding(): boolean;
  ride(entity: Entity): boolean;
  dismount(): boolean;

  // 视角
  getEntityFromViewVector(): Entity | null;
  getBlockFromViewVector(): Block | null;

  // 背包
  getHand(): Item;
  getOffHand(): Item & Container;
  getInventory(): Container;
  getArmor(): Container;
  refreshItems(): void;
  selectedSlot: number;
  setSelectedSlot?(slot: number): boolean;

  // NBT
  getNbt(): NbtCompound;
  setNbt(nbt: NbtCompound): boolean;
}

// ============================================================
// Entity 接口
// ============================================================

interface Entity {
  name: string;
  type: string;
  id: string;
  uniqueId: string;
  pos: FloatPos;
  getPos(): FloatPos;
  teleport(pos: FloatPos | IntPos, dimId?: number): boolean;
  isPlayer(): boolean;
  isItem(): boolean;
  remove(): boolean;
  setHealth(health: number): boolean;
  getHealth(): number;
  getMaxHealth(): number;
  hurt(damage: number, source?: number, attacker?: Player): boolean;
  interact(player: Player): boolean;
  ride(entity: Entity): boolean;
  getRider(): Entity | null;
  getAll(): Entity[];
}

// ============================================================
// Block 接口
// ============================================================

interface Block {
  name: string;
  type: string;
  id: number;
  data: number;
  pos: IntPos;
  getPos(): IntPos;
  getBlockData(): string;
  setBlockData(data: string): boolean;
  remove(): boolean;
  getContainer(): Container | null;
  hasContainer(): boolean;
  destroy(): boolean;
}

// ============================================================
// Container 接口
// ============================================================

interface Container {
  size: number;
  getSize(): number;
  getSlot(slot: number): Item | null;
  setItem(slot: number, item: Item | null): boolean;
  addItem(item: Item): boolean;
  removeItem(slot: number, count: number): boolean;
  getAllItems(): Item[];
  isEmpty(): boolean;
  hasRoomFor(item: Item): boolean;
  getItem(slot: number): Item;
}

// ============================================================
// Item 接口
// ============================================================

interface Item {
  name: string;
  type: string;
  id: number;
  count: number;
  data: number;
  isNull(): boolean;
  clone(): Item;
  setNull(): void;
  getExtraTag(): string;
  setExtraTag(tag: string): boolean;
  setLore(lores: string[]): boolean;
  getLore(): string[];
  setItemName(name: string): boolean;
  getDamage(): number;
  getMaxDamage(): number;
}