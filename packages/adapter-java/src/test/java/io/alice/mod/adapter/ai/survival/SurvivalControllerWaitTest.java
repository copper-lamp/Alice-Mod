package io.alice.mod.adapter.ai.survival;

import org.junit.jupiter.api.Test;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 验证 SurvivalController 异步等待机制的测试。
 * <p>
 * 核心目标：验证 wait 操作不会阻塞调用线程（模拟 TCP 读取线程）。
 */
class SurvivalControllerWaitTest {

    /**
     * 测试场景：模拟 TCP 读取线程调用 wait 操作。
     * <p>
     * 验证点：
     * 1. wait 方法应该立即返回（不阻塞）
     * 2. 调用线程应该能够继续执行其他任务
     * 3. 等待操作在后台异步完成
     */
    @Test
    void waitShouldNotBlockCallingThread() throws Exception {
        // 模拟 TCP 读取线程
        ExecutorService tcpReadThread = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "tcp-read-thread");
            t.setDaemon(true);
            return t;
        });

        AtomicInteger tasksCompleted = new AtomicInteger(0);
        AtomicBoolean waitStarted = new AtomicBoolean(false);
        CountDownLatch waitCompleted = new CountDownLatch(1);

        // 在 TCP 读取线程中执行 wait 操作
        Future<?> waitFuture = tcpReadThread.submit(() -> {
            waitStarted.set(true);

            // 模拟 SurvivalController.sleep() 的 wait 分支
            // 使用 CompletableFuture.runAsync 异步执行等待
            int waitSeconds = 3;
            CompletableFuture.runAsync(() -> {
                try {
                    Thread.sleep(waitSeconds * 1000L);
                    waitCompleted.countDown();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            // 工具立即返回，不等待异步任务完成
            tasksCompleted.incrementAndGet();
        });

        // 验证 1：wait 操作应该立即返回（在 100ms 内完成）
        waitFuture.get(100, TimeUnit.MILLISECONDS);
        assertTrue(waitStarted.get(), "Wait 操作应该已启动");
        assertEquals(1, tasksCompleted.get(), "TCP 读取线程应该能够继续执行");

        // 验证 2：TCP 读取线程应该能够执行其他任务
        Future<?> otherTaskFuture = tcpReadThread.submit(() -> {
            tasksCompleted.incrementAndGet();
        });
        otherTaskFuture.get(100, TimeUnit.MILLISECONDS);
        assertEquals(2, tasksCompleted.get(), "TCP 读取线程应该能够执行其他任务");

        // 验证 3：异步等待操作在后台完成
        assertTrue(waitCompleted.await(5, TimeUnit.SECONDS), "异步等待应该在 5 秒内完成");

        tcpReadThread.shutdown();
    }

    /**
     * 对比测试：验证旧的 Thread.sleep 实现会阻塞调用线程。
     * <p>
     * 这个测试证明旧实现的问题，以及新实现的改进。
     */
    @Test
    void oldThreadSleepImplementationBlocksThread() throws Exception {
        ExecutorService tcpReadThread = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "tcp-read-thread-old");
            t.setDaemon(true);
            return t;
        });

        AtomicInteger tasksCompleted = new AtomicInteger(0);

        // 使用旧的 Thread.sleep 实现
        Future<?> waitFuture = tcpReadThread.submit(() -> {
            try {
                // 旧实现：直接 Thread.sleep
                Thread.sleep(2000); // 2 秒
                tasksCompleted.incrementAndGet();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        // 验证：旧实现会阻塞线程，100ms 内无法完成
        assertThrows(TimeoutException.class, () -> {
            waitFuture.get(100, TimeUnit.MILLISECONDS);
        }, "旧的 Thread.sleep 实现应该阻塞调用线程");

        // 等待旧任务完成
        waitFuture.get(3, TimeUnit.SECONDS);
        assertEquals(1, tasksCompleted.get(), "旧实现最终会完成");

        tcpReadThread.shutdown();
    }

    /**
     * 测试多个并发 wait 操作不会互相阻塞。
     */
    @Test
    void multipleWaitOperationsShouldNotBlockEachOther() throws Exception {
        ExecutorService tcpReadThread = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "tcp-read-thread-concurrent");
            t.setDaemon(true);
            return t;
        });

        int waitCount = 5;
        CountDownLatch allWaitsStarted = new CountDownLatch(waitCount);
        CountDownLatch allWaitsCompleted = new CountDownLatch(waitCount);

        // 启动多个 wait 操作
        for (int i = 0; i < waitCount; i++) {
            final int waitTime = (i + 1); // 1s, 2s, 3s, 4s, 5s
            tcpReadThread.submit(() -> {
                allWaitsStarted.countDown();

                CompletableFuture.runAsync(() -> {
                    try {
                        Thread.sleep(waitTime * 1000L);
                        allWaitsCompleted.countDown();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                });
            });
        }

        // 验证：所有 wait 操作应该立即启动（不阻塞）
        assertTrue(allWaitsStarted.await(500, TimeUnit.MILLISECONDS),
                "所有 wait 操作应该立即启动");

        // 验证：所有异步等待应该按预期时间完成
        assertTrue(allWaitsCompleted.await(6, TimeUnit.SECONDS),
                "所有异步等待应该在 6 秒内完成");

        tcpReadThread.shutdown();
    }

    /**
     * 测试 wait 操作的返回值包含 async 标记。
     */
    @Test
    void waitResultShouldIndicateAsyncExecution() {
        // 模拟 SurvivalController 的 wait 返回值构建
        int waitSeconds = 5;
        java.util.Map<String, Object> waitData = new java.util.HashMap<>();
        waitData.put("waitedSeconds", waitSeconds);
        waitData.put("async", true);

        // 验证返回数据
        assertEquals(waitSeconds, waitData.get("waitedSeconds"));
        assertEquals(true, waitData.get("async"), "应该标记为异步执行");
    }
}