/*
 * 애니메이션·타이머 관리자.
 * 긴급 복귀(Escape 두 번, 처음으로)나 종료 때 진행 중인 애니메이션과 예약된 작업을
 * 한 번에 멈추기 위해, 체험 중 만든 애니메이션과 타이머를 모두 여기에 등록합니다.
 */

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

export class MotionRegistry {
  private readonly animations = new Set<Animation>();
  private readonly timers = new Set<number>();

  get reduced(): boolean {
    return prefersReducedMotion();
  }

  /** element.animate 래퍼. 움직임 줄이기 설정이면 길이를 짧게 줄입니다. */
  animate(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): Animation {
    const opts = { ...options };
    if (this.reduced) {
      opts.duration = Math.min(Number(opts.duration ?? 0), 160);
      opts.delay = Math.min(Number(opts.delay ?? 0), 40);
    }
    const animation = el.animate(keyframes, opts);
    this.animations.add(animation);
    const forget = () => this.animations.delete(animation);
    animation.addEventListener('finish', forget);
    animation.addEventListener('cancel', forget);
    return animation;
  }

  /** 애니메이션이 끝날 때까지 기다립니다(취소되어도 조용히 끝남). */
  async finished(animation: Animation): Promise<void> {
    try {
      await animation.finished;
    } catch {
      /* 취소됨 */
    }
  }

  later(ms: number, fn: () => void): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(ms, resolve));
  }

  clear(id: number): void {
    window.clearTimeout(id);
    this.timers.delete(id);
  }

  /** 등록된 모든 애니메이션과 타이머를 즉시 멈춥니다. */
  cancelAll(): void {
    for (const animation of [...this.animations]) animation.cancel();
    this.animations.clear();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  }

  get activeCount(): number {
    return this.animations.size + this.timers.size;
  }
}
