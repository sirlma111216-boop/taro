declare module 'virtual:card-art' {
  const cardArt: {
    /** 카드 ID → 이미지 경로 (public 기준 상대 경로). 파일이 있는 카드만 들어 있습니다. */
    art: Record<string, string>;
    back: string | null;
  };
  export default cardArt;
}
