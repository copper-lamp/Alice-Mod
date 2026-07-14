package io.alice.mod.adapter.api.types;

/**
 * 天气信息。
 */
public record WeatherInfo(
        boolean raining,
        boolean thundering,
        int rainTime,
        int thunderTime
) {}
