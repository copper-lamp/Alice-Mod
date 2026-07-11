"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._VALID_GAMEMODE_NAMES = exports._VALID_DIMENSION_NAMES = exports._SHORT_OPERATIONS_LIST = exports._LONG_OPERATIONS_LIST = exports.SUCCESS = exports._DEFAULT_PLAYER_SELECT_SLOT = exports._I18N_DIR = exports._FP_PERMISSION_DIR = exports._FP_INVENTORY_DIR = exports._FP_DATA_DIR = exports._CONFIG_PATH = void 0;
exports.InitGlobalVars = InitGlobalVars;
// Pre-defined paths and dirs
exports._CONFIG_PATH = "./plugins/LLSE-FakePlayer/config.json";
exports._FP_DATA_DIR = "./plugins/LLSE-FakePlayer/fpdata/";
exports._FP_INVENTORY_DIR = "./plugins/LLSE-FakePlayer/fpinventorys/";
exports._FP_PERMISSION_DIR = "./plugins/LLSE-FakePlayer/fppermissions/";
exports._I18N_DIR = "./plugins/LLSE-FakePlayer/LangPack";
// Pre-defined global consts
exports._DEFAULT_PLAYER_SELECT_SLOT = 0;
exports.SUCCESS = "";
exports._LONG_OPERATIONS_LIST = ["useitem"];
exports._SHORT_OPERATIONS_LIST = ["attack", "interact" /*, "destroy", "place" */, "clear"];
exports._VALID_DIMENSION_NAMES = [];
exports._VALID_GAMEMODE_NAMES = {};
function InitGlobalVars() {
    exports._VALID_DIMENSION_NAMES = [
        i18n.tr("dimension.name.mainworld"),
        i18n.tr("dimension.name.nether"),
        i18n.tr("dimension.name.end")
    ];
    exports._VALID_GAMEMODE_NAMES['0'] = i18n.tr("gameMode.name.survival");
    exports._VALID_GAMEMODE_NAMES['1'] = i18n.tr("gameMode.name.creative");
    exports._VALID_GAMEMODE_NAMES['2'] = i18n.tr("gameMode.name.adventure");
    exports._VALID_GAMEMODE_NAMES['5'] = i18n.tr("gameMode.name.default");
    exports._VALID_GAMEMODE_NAMES['6'] = i18n.tr("gameMode.name.spectator");
}
