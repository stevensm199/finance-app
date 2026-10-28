const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

export const looksLikeTransaction = (message: string, cues: string[]): boolean => {
  const normalizedMessage = normalize(message);
  return cues.some((cue) => normalizedMessage.includes(normalize(cue)));
};
