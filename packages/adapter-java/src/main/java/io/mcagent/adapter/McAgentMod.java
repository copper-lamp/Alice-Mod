package io.mcagent.adapter;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@net.fabricmc.api.Mod("mcagent-adapter")
public class McAgentMod implements ModInitializer {

    public static final Logger LOGGER = LoggerFactory.getLogger("mcagent-adapter");

    @Override
    public void onInitialize() {
        LOGGER.info("McAgent Adapter JE initializing...");
        LOGGER.info("McAgent Adapter JE initialized successfully.");
    }
}
