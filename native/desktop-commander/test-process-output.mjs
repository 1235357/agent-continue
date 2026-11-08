// Test-only observation: a successful start may precede the first output chunk.
export async function observeTestProcessOutput(started, marker, read, {
  now = () => performance.now(), budgetMs = 15000, maxReads = 16,
} = {}) {
  const pattern = marker instanceof RegExp && !marker.global && !marker.sticky;
  if ((!pattern && (typeof marker !== 'string' || !marker)) || typeof read !== 'function' ||
      !Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 20000 ||
      !Number.isSafeInteger(maxReads) || maxReads < 1 || maxReads > 32) throw new Error('test_process_options');
  const text = value => {
    if (!value || value.isError === true || !Array.isArray(value.content) ||
        value.content.some(part => part?.type === 'text' && typeof part.text !== 'string')) {
      throw new Error('test_process_result');
    }
    const output = value.content.filter(part => part?.type === 'text').map(part => part.text).join('\n');
    if (output.length > 65536) throw new Error('test_process_output_limit');
    return output;
  };
  let output = text(started);
  const matches = () => pattern ? marker.test(output) : output.includes(marker);
  const ids = [...output.matchAll(/(?:^|\n)Process started with PID ([1-9]\d{0,9})(?=\s|\(|$)/g)];
  if (ids.length !== 1) throw new Error('test_process_pid');
  const pid = Number(ids[0][1]), opened = now(), deadline = opened + budgetMs;
  if (!Number.isFinite(opened)) throw new Error('test_process_clock');
  for (let count = 0; !matches() && count < maxReads; count++) {
    const remaining = deadline - now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > budgetMs) break;
    let timer;
    try {
      const observed = await Promise.race([
        read({ name: 'read_process_output', arguments: { pid, timeout_ms: Math.min(1000, Math.ceil(remaining)) } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('test_process_output_unconfirmed')), remaining); }),
      ]);
      if (now() >= deadline || now() < opened) throw new Error('test_process_output_unconfirmed');
      output += text(observed);
      if (output.length > 65536) throw new Error('test_process_output_limit');
    } finally { clearTimeout(timer); }
  }
  if (!matches()) throw new Error('test_process_output_unconfirmed');
  return output;
}
