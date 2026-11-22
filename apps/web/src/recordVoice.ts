const sampleRate = 16_000;
const maxSeconds = 30;

// Browsers record different containers. Decode with Web Audio to resample and send
// the same bounded mono PCM format from Safari, Firefox and Chromium.
async function asWave(recording: Blob) {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await context.decodeAudioData(await recording.arrayBuffer());
  const length = Math.min(decoded.length, maxSeconds * sampleRate);
  if (!length) throw new Error("Запись пуста. Попробуйте ещё раз.");
  const bytes = new ArrayBuffer(44 + length * 2);
  const header = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  header.setUint32(4, bytes.byteLength - 8, true);
  tag(8, "WAVEfmt ");
  header.setUint32(16, 16, true); header.setUint16(20, 1, true);
  header.setUint16(22, 1, true); header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true); header.setUint16(32, 2, true);
  header.setUint16(34, 16, true); tag(36, "data");
  header.setUint32(40, length * 2, true);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (const channel of channels) value += channel[i];
    value = Math.max(-1, Math.min(1, value / channels.length));
    header.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function recordVoice(signal: AbortSignal, onStart: (stop: () => void) => void) {
  if (!window.isSecureContext) throw new Error("Для записи откройте сайт по HTTPS.");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.OfflineAudioContext)
    throw new Error("Браузер не поддерживает запись с микрофона. Введите вопрос с клавиатуры.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
  let recording: Blob;
  try {
    signal.throwIfAborted();
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let stopTimer = 0;
    const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
    signal.addEventListener("abort", stop, { once: true });
    try {
      recording = await new Promise<Blob>((resolve, reject) => {
        let bytes = 0;
        recorder.ondataavailable = ({ data }) => {
          bytes += data.size;
          if (bytes > 4 * 1024 * 1024) {
            stop();
            reject(new Error("Запись слишком длинная. Продиктуйте вопрос ещё раз."));
          } else if (data.size) chunks.push(data);
        };
        recorder.onerror = () => reject(new Error("Запись прервана. Проверьте микрофон."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.start(500);
        stopTimer = window.setTimeout(stop, maxSeconds * 1000);
        onStart(stop);
      });
    } finally {
      window.clearTimeout(stopTimer);
      signal.removeEventListener("abort", stop);
      stop();
    }
  } finally { stream.getTracks().forEach(track => track.stop()); }
  signal.throwIfAborted();
  return asWave(recording);
}
