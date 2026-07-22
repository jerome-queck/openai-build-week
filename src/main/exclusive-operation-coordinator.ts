export class ExclusiveOperationCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) throw new Error("The runtime transition coordinator is closing.");
    const preceding = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await preceding;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async closeAndDrain(): Promise<void> {
    this.accepting = false;
    await this.tail;
  }
}
