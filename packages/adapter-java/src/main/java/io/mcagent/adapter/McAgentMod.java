package io.alice.mod.adapter;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@net.fabricmc.api.Mod("alice-mod-adapter")
public class AliceModAdapter implements ModInitializer {

    public static final Logger LOGGER = LoggerFactory.getLogger("alice-mod-adapter");

    @Override
    public void onInitialize() {
        LOGGER.info("Alice Mod Adapter JE initializing...");
        LOGGER.info("Alice Mod Adapter JE initialized successfully.");
    }
}
