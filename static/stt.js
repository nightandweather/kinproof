// Chrome Web Speech wrapper: Korean, continuous, auto-restart, pause while TTS speaks.
// Production would swap this for on-device STT; the rest of the app only sees onFinal(text).
const STT = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, want = false, paused = false, handlers = {};

  function make() {
    rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) handlers.onFinal && handlers.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      handlers.onInterim && handlers.onInterim(interim);
    };
    rec.onerror = (e) => console.warn('stt error', e.error);
    rec.onend = () => { if (want && !paused) { try { rec.start(); } catch (_) {} } };
  }

  return {
    supported: !!SR,
    start(h) {
      if (!SR) { alert('Web Speech needs Chrome'); return; }
      handlers = h; want = true; paused = false; make(); rec.start();
    },
    stop() { want = false; if (rec) rec.stop(); handlers.onInterim && handlers.onInterim(''); },
    get running() { return want; },
    // Speak without transcribing ourselves.
    say(text) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.onstart = () => { paused = true; if (rec) rec.abort(); };
      u.onend = () => { paused = false; if (want) { make(); rec.start(); } };
      speechSynthesis.speak(u);
    },
  };
})();
