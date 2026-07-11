"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalConf = void 0;
exports.InitConfigFile = InitConfigFile;
const GlobalVars_1 = require("./GlobalVars");
let GlobalConf = null;
exports.GlobalConf = GlobalConf;
function InitConfigFile() {
    exports.GlobalConf = GlobalConf = new JsonConfigFile(GlobalVars_1._CONFIG_PATH);
    GlobalConf.init("Version", 2); // config file version
    GlobalConf.init("Language", "default");
    GlobalConf.init("LogLevel", 4);
    GlobalConf.init("MaxFpCountLimitEach", 3);
    GlobalConf.init("AutoOfflineWhenFrequentDeath", 1);
    GlobalConf.init("OpIsSu", 1);
    GlobalConf.init("SuList", []);
    GlobalConf.init("UserMode", "blacklist");
    GlobalConf.init("UserList", []);
    // if is old config file, process
    if (GlobalConf.get("OpIsAdmin") != null) {
        GlobalConf.delete("UserAllowAction");
        GlobalConf.set("UserMode", "blacklist");
        GlobalConf.set("UserList", []);
        GlobalConf.set("OpIsSu", GlobalConf.get("OpIsAdmin"));
        GlobalConf.delete("OpIsAdmin");
        GlobalConf.set("SuList", GlobalConf.get("AdminList"));
        GlobalConf.delete("AdminList");
    }
}
