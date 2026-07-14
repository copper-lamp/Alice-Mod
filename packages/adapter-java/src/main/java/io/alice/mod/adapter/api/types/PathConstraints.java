package io.alice.mod.adapter.api.types;

/**
 * 寻路约束参数。
 */
public record PathConstraints(
        boolean allowJump,
        boolean allowClimb,
        boolean allowSwim,
        int maxSearchNodes,
        long maxSearchTimeMs
) {

    public static final PathConstraints DEFAULT = new PathConstraints(true, true, true, 5000, 50);
}
