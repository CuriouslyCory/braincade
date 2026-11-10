import type { SpeechCapability } from '@braincade/game-host';

/** Text-to-speech through the Web Speech API, or undefined when the browser has none. */
export function webSpeech(
  win: Window & { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance } = window,
): SpeechCapability | undefined {
  const synth = win.speechSynthesis;
  const Utterance = win.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function') return undefined;
  return {
    speak: (text, { rate, language }) =>
      new Promise((resolve) => {
        const utterance = new Utterance(text);
        if (rate) utterance.rate = rate;
        if (language) utterance.lang = language;
        // Some browsers never fire `end` (no voices, tab hidden); don't hang the game.
        const timer = win.setTimeout(resolve, 2000 + (text.length * 150) / (rate ?? 1));
        const done = () => {
          win.clearTimeout(timer);
          resolve();
        };
        utterance.onend = done;
        utterance.onerror = done;
        synth.cancel();
        synth.speak(utterance);
      }),
    stop: () => synth.cancel(),
  };
}
