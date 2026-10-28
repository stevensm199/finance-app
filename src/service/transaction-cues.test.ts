import { describe, expect, it } from 'vitest';
import { looksLikeTransaction } from './transaction-cues.js';

describe('looksLikeTransaction', () => {
  const cues = ['gaste', 'pague', 'gane', 'transferi'];

  it('matches configured cues with or without Spanish accents', () => {
    expect(looksLikeTransaction('Gasté 120.000 en Netflix', cues)).toBe(true);
    expect(looksLikeTransaction('Transferí 50 a mi cuenta', cues)).toBe(true);
  });

  it('skips messages without any configured transaction cue', () => {
    expect(looksLikeTransaction('Hola, ¿cómo estás? 20.000 en Netflix', cues)).toBe(false);
  });
});
