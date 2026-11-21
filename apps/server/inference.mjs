import { parentPort, workerData } from "node:worker_threads";
import { pipeline, env } from "@huggingface/transformers";
env.cacheDir = workerData.cacheDir;
env.backends.onnx.logLevel = "error";
let extractor;
parentPort.on("message", async ({ sentences, query, localFilesOnly }) => {
  try {
    extractor ??= await pipeline(
      "feature-extraction",
      "Xenova/multilingual-e5-small",
      {
        revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
        dtype: "q8",
        local_files_only: localFilesOnly,
        device: "cpu",
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      },
    );
    const tensor = await extractor(
      ["query: " + query, ...sentences.map((s) => "passage: " + s)],
      { pooling: "mean", normalize: true, truncation: true, max_length: 256 },
    );
    const vectors = tensor.tolist(),
      q = vectors[0];
    const ranked = vectors
      .slice(1)
      .map((v, i) => ({
        index: i,
        score: v.reduce((sum, x, j) => sum + x * q[j], 0),
      }))
      .sort((a, b) => b.score - a.score);
    parentPort.postMessage({
      indices: ranked
        .slice(0, 2)
        .map((r) => r.index)
        .sort((a, b) => a - b),
      dimensions: q.length,
    });
  } catch {
    parentPort.postMessage({ error: "Не удалось выполнить локальную модель" });
  }
});
