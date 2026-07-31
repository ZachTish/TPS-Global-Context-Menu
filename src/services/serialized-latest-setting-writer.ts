export interface SerializedSettingAccess<Value> {
  get: () => Value;
  set: (value: Value) => void;
  persist: () => Promise<void>;
}

export type SerializedSettingWriteResult = 'applied' | 'superseded';

export class SerializedLatestSettingWriter<Key, Value> {
  private readonly generations = new Map<Key, number>();
  private readonly queues = new Map<Key, Promise<void>>();

  async write(
    key: Key,
    value: Value,
    access: SerializedSettingAccess<Value>,
  ): Promise<SerializedSettingWriteResult> {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const previous = this.queues.get(key) ?? Promise.resolve();
    let operation: Promise<void>;
    operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (!this.isLatest(key, generation)) return;
        const previousValue = access.get();
        access.set(value);
        try {
          await access.persist();
        } catch (error) {
          let restored = false;
          if (Object.is(access.get(), value)) {
            access.set(previousValue);
            restored = true;
          }
          if (restored && this.isLatest(key, generation)) {
            try {
              await access.persist();
            } catch (rollbackError) {
              const combinedError = new Error(
                'The setting write and its compensating rollback both failed.',
              ) as Error & { errors?: unknown[] };
              combinedError.errors = [error, rollbackError];
              throw combinedError;
            }
          }
          throw error;
        }
      });
    this.queues.set(key, operation);

    try {
      await operation;
      return this.isLatest(key, generation) ? 'applied' : 'superseded';
    } catch (error) {
      if (!this.isLatest(key, generation)) return 'superseded';
      throw error;
    } finally {
      if (this.queues.get(key) === operation) this.queues.delete(key);
    }
  }

  private isLatest(key: Key, generation: number): boolean {
    return this.generations.get(key) === generation;
  }
}
