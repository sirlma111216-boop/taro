// 단위 테스트(Node)용 'cloudflare:workers' 대역. Durable Object 클래스가 불러와지고 타입 검사만 통과하면 됩니다.
interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export class DurableObject<Env = unknown> {
  protected ctx: { storage: StorageLike };
  protected env: Env;

  constructor(ctx: { storage: StorageLike }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
