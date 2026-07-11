"use strict";
/// <reference path="E://TelluriumDev//HelperLib//src//index.d.ts"/>
Object.defineProperty(exports, "__esModule", { value: true });
const _VER = [2, 0, 1];
const GlobalVars_1 = require("./Utils/GlobalVars");
const ConfigFileHelper_1 = require("./Utils/ConfigFileHelper");
const PermManager_1 = require("./Utils/PermManager");
const FakePlayerManager_1 = require("./FpManager/FakePlayerManager");
const CommandRegistry_1 = require("./Command/CommandRegistry");
function InitI18n() {
    let lang = ConfigFileHelper_1.GlobalConf.get("Language", "default");
    if (lang == "default")
        lang = "";
    i18n.load(GlobalVars_1._I18N_DIR, lang);
}
function main() {
    (0, ConfigFileHelper_1.InitConfigFile)();
    InitI18n();
    (0, GlobalVars_1.InitGlobalVars)();
    // ll.registerPlugin(
    //     /* name */ "LLSE-FakePlayer",
    //     /* introduction */ "A strong fake-player plugin for LiteLoaderBDS",
    //     /* version */[0, 0, 0],
    //     /* otherInformation */ { "Author": "yqs112358" }
    // )
    logger.setLogLevel(ConfigFileHelper_1.GlobalConf.get("LogLevel", 4));
    FakePlayerManager_1.FakePlayerManager.loadAllFpData();
    PermManager_1.PermManager.initPermManager();
    //logger.debug("FpList: ", FakePlayerManager.fpList);
    mc.listen("onTick", FakePlayerManager_1.FakePlayerManager.onTick);
    mc.listen("onPlayerDie", FakePlayerManager_1.FakePlayerManager.onPlayerDie);
    mc.listen("onJoin", (pl) => {
        if (!pl.isSimulatedPlayer())
            CommandRegistry_1.PlayerListSoftEnum.add(pl.realName);
    });
    mc.listen("onLeft", (pl) => {
        if (!pl.isSimulatedPlayer())
            CommandRegistry_1.PlayerListSoftEnum.remove(pl.realName);
    });
    mc.listen("onServerStarted", () => {
        // command registry
        (0, CommandRegistry_1.RegisterCmd)();
        // auto reconnect
        let res = FakePlayerManager_1.FakePlayerManager.initialAutoOnline();
        if (res != GlobalVars_1.SUCCESS) {
            logger.warn(i18n.tr("main.autoreconnect.error") + "\n" + res);
        }
    });
    (0, FakePlayerManager_1.ExportFakePlayerAPIs)();
    logger.info(i18n.tr("main.welcome", "v" + _VER.join(".")));
}
main();
