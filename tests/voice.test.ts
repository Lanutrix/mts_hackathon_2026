import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerVoice, voicePath } from "../apps/server/voice.ts";

function wave(samples: number, amplitude = 2000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(amplitude * Math.sin(i / 8)), 44 + i * 2);
  return bytes;
}

test("voice accepts bounded mono PCM for an authorized assistant session", async () => {
  const app = Fastify();
  const calls: Buffer[] = [];
  const provider = { async transcribe(audio: Buffer) { calls.push(audio); return "Покажи заявки."; } };
  registerVoice(app, provider, (req, reply) => {
    if (req.headers.authorization === "allowed") return true;
    reply.code(403).send();
    return false;
  });
  try {
    const send = (audio: Buffer, auth = "allowed") => app.inject({ method: "POST", url: voicePath,
      headers: { authorization: auth, "content-type": "audio/wav" }, payload: audio });
    const spoken = wave(16_000);
    assert.equal((await send(spoken, "denied")).statusCode, 403);
    assert.equal((await send(wave(16_000, 0))).statusCode, 422);
    const stereo = wave(16_000); stereo.writeUInt16LE(2, 22);
    assert.equal((await send(stereo)).statusCode, 400);
    assert.equal((await send(wave(16_000 * 31))).statusCode, 413);
    const result = await send(spoken);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { text: "Покажи заявки." });
    assert.deepEqual(calls, [spoken]);
  } finally { await app.close(); }
});
