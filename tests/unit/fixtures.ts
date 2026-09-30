import type { Reading } from '../../src/shared/types.ts';

export function validReading(ids: string[]): Reading {
  return {
    cards: ids.map((cardId, i) => ({
      cardId,
      headline: `${i + 1}번째 카드의 한 문장 결론이에요.`,
      symbolism: '카드 그림 속 상징이 지금의 마음을 비춰 주고 있어요.',
      topicReading: '선택한 주제와 연결하면 먼저 작은 인사를 건네 보는 것이 좋아요.',
      action: '오늘 쉬는 시간에 한 명에게 먼저 인사해 보기',
    })),
    summary: {
      title: '작은 용기의 별',
      conclusion: '천천히 다가가도 괜찮아요.',
      combined: '세 장을 함께 보면 지금의 마음을 인정하고 작은 행동으로 이어 가는 흐름이에요.',
      caution: '서두르지 않기',
      prepare: '하고 싶은 말을 한 줄로 적어 보기',
      todayAction: '먼저 웃으며 인사하기',
    },
    print: {
      headline: '천천히 다가가도 괜찮아요',
      advice: '하고 싶은 말을 한 줄로 적고 먼저 인사해 보세요.',
      caution: '서두르지 않기',
      cheer: '오늘의 작은 용기를 응원해요',
      miniAdvice: '먼저 인사해 보기',
      miniCaution: '서두르지 않기',
    },
  };
}

/** Gemini generateContent 응답 모양으로 감쌉니다. */
export function geminiResponse(text: string, finishReason = 'STOP'): unknown {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: '생각 요약(표시하면 안 됨)', thought: true }, { text }],
        },
        finishReason,
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
    modelVersion: 'gemini-3.8-flash',
  };
}
