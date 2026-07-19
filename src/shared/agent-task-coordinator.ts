export interface CoordinatedAgentTask {
  id: string;
  dependsOnTaskIds: string[];
  run(): Promise<void>;
}

export async function coordinateAgentTasks(tasks: CoordinatedAgentTask[], concurrency: number): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Agent Task concurrency must be a positive integer.");
  }
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length || tasks.some((task) => !task.id.trim()
    || task.dependsOnTaskIds.some((dependencyId) => !ids.has(dependencyId) || dependencyId === task.id))) {
    throw new Error("Agent Task dependencies are invalid.");
  }
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const running = new Map<string, Promise<string>>();
  const completed = new Set<string>();

  while (pending.size > 0 || running.size > 0) {
    for (const task of pending.values()) {
      if (running.size >= concurrency) break;
      if (!task.dependsOnTaskIds.every((dependencyId) => completed.has(dependencyId))) continue;
      pending.delete(task.id);
      running.set(task.id, task.run().then(() => task.id));
    }
    if (running.size === 0) throw new Error("Agent Task dependencies contain a cycle.");
    try {
      const completedId = await Promise.race(running.values());
      running.delete(completedId);
      completed.add(completedId);
    } catch (error) {
      await Promise.allSettled(running.values());
      throw error;
    }
  }
}
