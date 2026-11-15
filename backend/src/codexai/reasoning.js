// Groq's current models are "reasoning" models. Chat and Circle to Ask want a fast final answer, so ask for the least
// reasoning each family supports (Qwen 3.6: "none"; GPT-OSS: "low"). Other models get no extra parameters.
export function reasoningParams(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('qwen/qwen3')) return { reasoning_effort: 'none' };
  if (m.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low' };
  return {};
}
