// All document processing stays inside this extension. Never log document data,
// file names, parser errors, or extracted text. A caller may choose to reveal the
// returned text locally, but it must not include it in diagnostic reports.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 100_000;
export const SUPPORTED_ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.yaml,.yml,.xml,.log,.ini,.cfg,.conf,.rst,.tex,.html,.htm,.docx,.pdf';

const TEXT_FORMATS = new Set('txt md markdown csv tsv json jsonl yaml yml xml log ini cfg conf rst tex'.split(' '));
const ENCODINGS = new Set(['auto', 'utf-8', 'gb18030', 'utf-16le', 'utf-16be']);
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const PDF_TIMEOUT_MS = 20_000;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}
const fail = (code, message) => { throw new ImportError(code, message); };

function validateText(text) {
  if (text.length > MAX_PROMPT_CHARS) fail('TEXT_TOO_LARGE', '提取的文字超过 100,000 个字符，请缩短文档后导入。');
  if (!text.trim()) fail('EMPTY_TEXT', '文件中没有可用文字。');
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) {
    fail('BINARY_TEXT', '文件包含非文本控制字符，请保存为 UTF-8 纯文本后再导入。');
  }
  return text;
}

function decodeText(bytes, requestedEncoding) {
  let encoding = requestedEncoding;
  let skip = 0;
  let warnings = [];
  if (encoding === 'auto') {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { encoding = 'utf-8'; skip = 3; }
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; skip = 2; }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; skip = 2; }
    else {
      try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), warnings }; }
      catch {
        encoding = 'gb18030';
        warnings = ['文件不是有效的 UTF-8，已按 GB18030 解码。若出现乱码，请手动选择编码或另存为 UTF-8。'];
      }
    }
  }
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(skip)), warnings };
  } catch {
    fail('ENCODING', '无法按所选编码读取文件。请检查编码，或另存为 UTF-8 纯文本。');
  }
}

function htmlToText(source) {
  // A detached template is inert: its scripts do not execute and its resources
  // are not loaded. Never append this fragment or any parsed node to the page.
  const template = document.createElement('template');
  template.innerHTML = source;
  template.content.querySelectorAll('script,style,iframe,object,embed,template,noscript,svg,math,head').forEach(node => node.remove());
  const blocks = new Set('address article aside blockquote div dl dt dd fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tr ul'.split(' '));
  let output = '';
  const append = value => {
    output += value;
    if (output.length > MAX_PROMPT_CHARS) fail('TEXT_TOO_LARGE', '提取的文字超过 100,000 个字符，请缩短文档后导入。');
  };
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) { append(node.nodeValue || ''); return; }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const tag = node.localName;
    if (tag === 'br') { append('\n'); return; }
    if (blocks.has(tag) && output && !output.endsWith('\n')) append('\n');
    for (const child of node.childNodes) visit(child);
    if ((tag === 'td' || tag === 'th') && node.nextElementSibling) append('\t');
    if (blocks.has(tag) && output && !output.endsWith('\n')) append('\n');
  }
  visit(template.content);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateBounded(compressed, expectedSize) {
  if (typeof DecompressionStream !== 'function') fail('BROWSER', '此浏览器缺少本地 DOCX 解压支持，请更新 Chrome 或 Edge。');
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_XML_BYTES || total > expectedSize) fail('DOCX_LIMIT', 'DOCX 正文解压后过大，或文件的大小信息不一致。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ImportError) throw error;
    fail('DOCX_INVALID', 'DOCX 压缩数据损坏，无法导入。');
  } finally { reader.releaseLock(); }
  if (total !== expectedSize) fail('DOCX_INVALID', 'DOCX 正文大小不一致，文件可能已损坏。');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

async function docxXml(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => fail('DOCX_INVALID', '无法读取 DOCX 文档结构。请用 Word 另存为标准 .docx 或 .txt。');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0) invalid();
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || entries !== view.getUint16(end + 8, true)) invalid();
  if (entries > 4096 || directoryOffset + directorySize > end || directoryOffset === 0xffffffff || directorySize === 0xffffffff) invalid();
  let at = directoryOffset;
  let found = null;
  for (let index = 0; index < entries; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) invalid();
    const nameSize = view.getUint16(at + 28, true);
    const extraSize = view.getUint16(at + 30, true);
    const commentSize = view.getUint16(at + 32, true);
    const next = at + 46 + nameSize + extraSize + commentSize;
    if (next > directoryOffset + directorySize) invalid();
    const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(at + 46, at + 46 + nameSize));
    if (name === 'word/document.xml') {
      if (found) invalid();
      found = {
        flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true),
        crc: view.getUint32(at + 16, true), compressedSize: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true), offset: view.getUint32(at + 42, true),
      };
    }
    at = next;
  }
  if (!found || at !== directoryOffset + directorySize) invalid();
  if (found.flags & 1) fail('ENCRYPTED', '不支持加密 DOCX。请先在本机解密，或导出为纯文本。');
  if (![0, 8].includes(found.method)) fail('DOCX_COMPRESSION', '不支持该 DOCX 压缩方式。请用 Word 另存为标准 .docx。');
  if (found.size > MAX_XML_BYTES || found.compressedSize > MAX_FILE_BYTES) fail('DOCX_LIMIT', 'DOCX 正文解压后超过 4 MiB，请缩短文档后导入。');
  at = found.offset;
  if (at + 30 > directoryOffset || view.getUint32(at, true) !== 0x04034b50) invalid();
  if (view.getUint16(at + 6, true) !== found.flags || view.getUint16(at + 8, true) !== found.method) invalid();
  const localNameSize = view.getUint16(at + 26, true);
  const start = at + 30 + localNameSize + view.getUint16(at + 28, true);
  if (start + found.compressedSize > directoryOffset) invalid();
  if (new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + localNameSize)) !== 'word/document.xml') invalid();
  const compressed = bytes.subarray(start, start + found.compressedSize);
  const xml = found.method === 8 ? await inflateBounded(compressed, found.size) : compressed;
  if (xml.length !== found.size || crc32(xml) !== found.crc) invalid();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(xml); }
  catch { invalid(); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) fail('DOCX_XML', 'DOCX 包含不支持的 XML 实体声明，无法导入。');
  return source;
}

async function docxToText(bytes) {
  const source = await docxXml(bytes);
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) fail('DOCX_XML', 'DOCX 正文 XML 损坏，无法导入。');
  const root = parsed.documentElement;
  if (root.localName !== 'document' || ![WORD_NS, STRICT_WORD_NS].includes(root.namespaceURI)) fail('DOCX_XML', 'DOCX 缺少标准 Word 正文结构。');
  let text = '';
  const append = value => {
    text += value;
    if (text.length > MAX_PROMPT_CHARS) fail('TEXT_TOO_LARGE', '提取的文字超过 100,000 个字符，请缩短文档后导入。');
  };
  const visit = node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const isWord = [WORD_NS, STRICT_WORD_NS].includes(node.namespaceURI);
    if (isWord && ['del', 'instrText', 'drawing', 'pict'].includes(node.localName)) return;
    if (isWord && node.localName === 't') { append(node.textContent || ''); return; }
    if (isWord && ['br', 'cr'].includes(node.localName)) { append('\n'); return; }
    if (isWord && node.localName === 'tab') { append('\t'); return; }
    for (const child of node.children) visit(child);
    if (isWord && node.localName === 'p') append('\n');
    if (isWord && node.localName === 'tc' && node.nextElementSibling) append('\t');
  };
  visit(root);
  // Word paragraphs necessarily terminate in a paragraph break. Keep all of
  // them so intentionally empty paragraphs survive extraction.
  return text;
}

async function pdfToText(bytes) {
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) fail('PDF_INVALID', '文件不是可识别的 PDF。');
  const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
  // Supply a real same-origin Worker explicitly. PDF.js's URL-origin fallback
  // creates a blob wrapper for extension URLs, which the extension CSP rejects.
  const nativeWorker = new Worker(new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url), { type: 'module' });
  const worker = new pdfjs.PDFWorker({ port: nativeWorker, verbosity: 0 });
  let loading;
  let timer;
  let timedOut = false;
  let encrypted = false;
  try {
    loading = pdfjs.getDocument({
      data: bytes, worker, verbosity: 0, isEvalSupported: false,
      enableXfa: false, useWasm: false, useSystemFonts: false, disableFontFace: true,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      disableAutoFetch: true, disableRange: true, disableStream: true,
      useWorkerFetch: true,
      cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
    });
    // No password dialog or credential storage. Reject through the documented
    // callback so loading.promise settles instead of waiting indefinitely.
    loading.onPassword = updatePassword => {
      encrypted = true;
      updatePassword(new Error('Encrypted PDF is not supported.'));
    };
    const operation = (async () => {
      const doc = await loading.promise;
      if (doc.numPages > MAX_PDF_PAGES) fail('PDF_PAGES', 'PDF 超过 100 页，请拆分文档后导入。');
      let text = '';
      for (let number = 1; number <= doc.numPages; number++) {
        const page = await doc.getPage(number);
        const stream = page.streamTextContent({ disableNormalization: true });
        const reader = stream.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const item of value.items) {
              if (typeof item.str !== 'string') continue;
              text += item.str;
              if (item.hasEOL) text += '\n';
              if (text.length > MAX_PROMPT_CHARS) fail('TEXT_TOO_LARGE', '提取的文字超过 100,000 个字符，请缩短文档后导入。');
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          page.cleanup();
        }
        if (number < doc.numPages) text += '\n';
      }
      if (!text.trim()) fail('PDF_NO_TEXT', 'PDF 没有可提取的文本层，可能是扫描件。本扩展不做 OCR，请先在本机导出文字。');
      return text;
    })();
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          nativeWorker.terminate();
          reject(new ImportError('PDF_TIMEOUT', 'PDF 解析超过 20 秒，请缩短文档或导出为纯文本。'));
        }, PDF_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (encrypted) fail('ENCRYPTED', '不支持加密 PDF。请先在本机解密，或导出为纯文本。');
    // Do not include PDF.js exception text: it may quote document data.
    fail('PDF_INVALID', '无法提取 PDF 文字。文件可能已损坏或加密；请在本机解密或导出为纯文本。');
  } finally {
    clearTimeout(timer);
    if (!timedOut && loading) {
      // A malformed document or failed Worker must not turn cleanup into an
      // unbounded wait. Terminate the native Worker after a short grace period.
      let cleanupTimer;
      try {
        await Promise.race([
          loading.destroy().catch(() => {}),
          new Promise(resolve => { cleanupTimer = setTimeout(resolve, 500); }),
        ]);
      } finally { clearTimeout(cleanupTimer); }
    }
    worker.destroy();
    nativeWorker.terminate();
  }
}

/**
 * Import a user-selected File or named Blob. No upload occurs. Returned text is
 * the runtime prompt; callers should hide it unless the user chooses to reveal.
 * Parser errors intentionally contain only fixed, content-free messages.
 */
export async function importPromptFile(file, { encoding = 'auto' } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || !Number.isFinite(file.size)) {
    fail('FILE_REQUIRED', '请选择一个本机文件。');
  }
  if (!ENCODINGS.has(encoding)) fail('ENCODING', '不支持所选文件编码。');
  if (file.size < 1) fail('EMPTY_FILE', '所选文件是空文件。');
  if (file.size > MAX_FILE_BYTES) fail('FILE_TOO_LARGE', '文件超过 5 MiB，请缩短文档后导入。');
  const format = file.name.split('.').at(-1).toLowerCase();
  if (!TEXT_FORMATS.has(format) && !['html', 'htm', 'docx', 'pdf'].includes(format)) {
    fail('FORMAT', '不支持这种文件格式。可导入 TXT、Markdown、常见文本格式、HTML、DOCX 或带文本层的 PDF。');
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > MAX_FILE_BYTES) fail('FILE_SIZE', '读取的文件大小不一致，请重新选择文件。');
    let text;
    let warnings = [];
    if (format === 'docx') {
      text = await docxToText(bytes);
      warnings = ['DOCX 只提取正文、段落和表格文字，不包含图片、页眉页脚、脚注或批注；请在本机预览核对。'];
    } else if (format === 'pdf') {
      text = await pdfToText(bytes);
      warnings = ['PDF 按文本层提取；多栏、表格和特殊字体可能影响阅读顺序。需要逐字保真的提示词请使用 TXT 或 Markdown。'];
    } else {
      const decoded = decodeText(bytes, encoding);
      text = decoded.text;
      warnings = decoded.warnings;
      if (format === 'html' || format === 'htm') {
        text = htmlToText(text);
        warnings = [...warnings, 'HTML 只提取静态正文文字；不执行脚本、不加载外部资源，也不保留样式。'];
      }
    }
    return { text: validateText(text), format, warnings };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail('IMPORT_FAILED', '文件无法导入。请另存为 UTF-8 纯文本后再试。');
  }
}
