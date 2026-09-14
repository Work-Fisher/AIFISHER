import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import express from 'express';
import { isAgentDocument } from '../../../src/shared/agentDocumentFormats.js';


export class DramaScriptImportError extends Error {
  constructor(message) { super(message); this.name = 'DramaScriptImportError'; }
}

function fail(message) { throw new DramaScriptImportError(message); }

function decode(bytes, encoding = 'utf-8') {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return fail('剧本文本编码无法识别，请另存为 UTF-8 文本后上传。'); }
}

function xmlText(xml, preserveWhitespace) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('剧本包含不支持的 XML 声明。');
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescape = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_all, entity) => {
    if (entities[entity]) return entities[entity];
    const number = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(number) || number < 1 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) {
      fail('剧本中存在无效字符。');
    }
    return String.fromCodePoint(number);
  });
  // Bounded single pass: malformed repeated opening tags must not cause regex backtracking.
  // Relationships, fields, hyperlinks and embedded objects are never resolved.
  const output = [];
  const stack = [];
  let cursor = 0;
  const append = (value) => {
    output.push(value);
  };
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    const textEnd = start < 0 ? xml.length : start;
    if (stack.at(-1)?.split(':').at(-1) === 't') append(unescape(xml.slice(cursor, textEnd)));
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) fail('DOCX 正文 XML 不完整。');
      cursor = end + 3; continue;
    }
    let end = start + 1;
    let quote = '';
    for (; end < xml.length; end += 1) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') fail('DOCX 正文 XML 标签无效。');
    }
    if (end === xml.length) fail('DOCX 正文 XML 不完整。');
    const token = xml.slice(start + 1, end).trim();
    cursor = end + 1;
    if (token.startsWith('?xml') && token.endsWith('?')) continue;
    const match = /^(\/)?([A-Za-z_][\w:.-]*)(?:\s[^]*)?(\/)?$/.exec(token);
    if (!match) fail('DOCX 正文 XML 标签无效。');
    const name = match[2];
    const closing = Boolean(match[1]);
    const empty = token.endsWith('/');
    if (closing) {
      if (stack.pop() !== name) fail('DOCX 正文 XML 标签不匹配。');
      if (name.split(':').at(-1) === 'p') append('\n');
    } else if (!empty) {
      if (stack.at(-1)?.split(':').at(-1) === 't' || stack.length >= 128) fail('DOCX 正文 XML 嵌套无效。');
      stack.push(name);
    } else if (['br', 'tab'].includes(name.split(':').at(-1))) {
      append(preserveWhitespace && name.split(':').at(-1) === 'tab' ? '\t' : '\n');
    }
  }
  if (stack.length) fail('DOCX 正文 XML 不完整。');
  return output.join('');
}

function readDocx(bytes, preserveWhitespace) {
  if (bytes.length < 22) fail('DOCX 文件不完整。');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('不支持此 DOCX 压缩格式。');
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  const directoryEnd = cursor + directorySize;
  if (!entries || entries > 2048 || directoryEnd > end || bytes.readUInt16LE(end + 8) !== entries) {
    fail('DOCX 文件目录无效或文件数量过多。');
  }
  let documentXml = null;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('DOCX 文件目录不完整。');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) fail('DOCX 文件目录不完整。');
    const filename = decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (filename === 'word/document.xml') {
      if (documentXml !== null || flags & 1 || ![0, 8].includes(method)) {
        fail('DOCX 正文重复、加密或超过大小限制。');
      }
      if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) fail('DOCX 正文位置无效。');
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      if (start + compressed > bytes.readUInt32LE(end + 16)) fail('DOCX 正文数据不完整。');
      const localName = decode(bytes.subarray(offset + 30, offset + 30 + bytes.readUInt16LE(offset + 26)));
      if (localName !== filename || bytes.readUInt16LE(offset + 8) !== method || bytes.readUInt16LE(offset + 6) & 1) {
        fail('DOCX 正文目录不一致。');
      }
      try {
        const data = bytes.subarray(start, start + compressed);
        documentXml = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, expanded) });
      } catch { fail('DOCX 正文无法解压或超过大小限制。'); }
      if (documentXml.length !== expanded) fail('DOCX 正文长度不一致。');
    }
    cursor = next;
  }
  if (!documentXml) fail('DOCX 中没有可读取的正文，请导出为 TXT。');
  return xmlText(decode(documentXml), preserveWhitespace);
}

export function importDramaScript({ name, contentBase64, preserveWhitespace = false } = {}) {
  if (typeof preserveWhitespace !== 'boolean') fail('文档空白保留选项无效。');
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\\/\0\r\n]/.test(name)) fail('剧本文件名无效。');
  if (!isAgentDocument(name)) fail('支持 Word（DOCX）、TXT、Markdown、CSV、TSV、JSON、YAML、XML、LOG、SRT 和 VTT。旧版 DOC 请另存为 DOCX。');
  if (typeof contentBase64 !== 'string'
    || contentBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(contentBase64)) fail('剧本文件内容无效或无效。');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (bytes.toString('base64') !== contentBase64) fail('剧本文件内容编码无效。');
  if (!bytes.length) fail('剧本文件为空或无效。');
  let text;
  if (/\.docx$/i.test(name)) text = readDocx(bytes, preserveWhitespace);
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) text = decode(bytes.subarray(2), 'utf-16le');
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = decode(bytes.subarray(2), 'utf-16be');
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = decode(bytes, 'gb18030'); }
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!preserveWhitespace) text = text.trim();
  if (!text.trim() || /\0/.test(text)) fail('正文为空或包含无效字符。');
  return { name, text };
}

export function createDramaScriptImportRouter() {
  const router = express.Router();
  router.post('/api/agent/drama/script', express.json({ limit: Infinity }), (request, response) => {
    try { response.json({ script: importDramaScript(request.body) }); }
    catch (error) {
      response.status(400).json({ error: error instanceof DramaScriptImportError ? error.message : '剧本文件无法读取。', code: 'DRAMA_SCRIPT_INVALID' });
    }
  });
  return router;
}
