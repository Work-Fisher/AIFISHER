import { doubaoThinkingParameters } from '../providers/doubaoThinking.js';
/**
 * Provider request implementation used by the durable Agent HTTP Module.
 */

import { resolveImageToBase64 } from "../utils/imageHelpers.js";
import { CHAT_AGENT_SYSTEM_PROMPT } from "./prompts/system.js";

// ============================================================================
// SESSION MANAGEMENT (IN-MEMORY PROVIDER CONTEXT)
// ============================================================================

/**
 * In-memory cache for active sessions
 * Sessions are also persisted to disk after each message
 */
const sessionCache = new Map();

/**
 * Convert multimodal content to text representation for serialization
 * This ensures context is preserved without huge base64 data
 */
function contentToText(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        const parts = [];
        let imageCount = 0;

        for (const part of content) {
            if (part.type === 'text') {
                parts.push(part.text);
            } else if (part.type === 'image_url') {
                imageCount++;
                parts.push(`[IMAGE ${imageCount} ATTACHED]`);
            }
        }

        return parts.join('\n');
    }

    return JSON.stringify(content);
}

// 将附件转换为豆包文本模型支持的多模态内容块
function buildDoubaoContent(text, media, options = {}) {
    const detailLevel = ['low', 'high', 'xhigh'].includes(options?.detail) ? options.detail : 'high';
    const content = [];

    const normalizeRawToDataUrl = (raw, mime) => {
        if (!raw || typeof raw !== 'string') return null;
        const val = raw.trim();
        if (!val) return null;
        if (val.startsWith('data:')) return val;
        if (/^https?:\/\//i.test(val)) return val;
        // 兼容前端传来的“裸 base64”（无 data: 前缀）
        const base64Like = /^[A-Za-z0-9+/=\r\n]+$/.test(val) && val.length > 128;
        if (base64Like) {
            const compact = val.replace(/\s+/g, '');
            return `data:${mime};base64,${compact}`;
        }

        const resolved = resolveImageToBase64(val);
        if (resolved) return resolved;

        return null;
    };

    if (Array.isArray(media)) {
        media.forEach((m) => {
            // Prefer the complete data URL when both fields are present. A
            // bare Base64 fallback is normalized above for legacy callers.
            const candidates = [m?.url, m?.base64]
                .map((value) => typeof value === 'string' ? value.trim() : '')
                .filter(Boolean);
            const isUsable = (value) => value.startsWith('/library/media/')
                || /^https?:\/\//i.test(value)
                || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)
                || (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 128);
            const raw = candidates.find(isUsable);
            if (!raw) return;

            if (m.type === 'image') {
                const normalized = normalizeRawToDataUrl(raw, 'image/png');
                if (normalized) {
                    content.push({ type: 'input_image', image_url: normalized, detail: detailLevel });
                }
                return;
            }

            // Agent 暂时仅支持图片附件，多媒体输入统一忽略
            return;
        });
    }

    content.push({ type: 'input_text', text: (text || '').trim() || '请分析我上传的素材。' });
    return content;
}

// 将豆包内容块映射为 OpenAI Chat Completions 内容格式
function toOpenAIContentBlocks(parts = []) {
    return (Array.isArray(parts) ? parts : []).map((item) => {
        if (item?.type === 'input_text') {
            return { type: 'text', text: item?.text || '' };
        }
        if (item?.type === 'input_image') {
            const detail = ['low', 'high', 'auto'].includes(item?.detail) ? item.detail : 'auto';
            return { type: 'image_url', image_url: { url: item?.image_url, detail } };
        }
        return null;
    }).filter(Boolean);
}

function resolveOpenAiAgentUrl(finalModel) {
    const modelKey = String(finalModel || '').replace(/[\s.-]/g, '_').toUpperCase();
    const modeKey = 'MULTIMODAL_CHAT';
    const modeEnv = process.env[`MODEL_URL_${modelKey}_${modeKey}`];
    const commonEnv = process.env[`MODEL_URL_${modelKey}`];
    return String(modeEnv || commonEnv || 'https://api.openai.com/v1/chat/completions').trim();
}

/**
 * Get or create a chat session
 * @param {string} sessionId - Unique session identifier
 * @returns {object} Session object
 */
export function getSession(sessionId) {
    // Check cache first
    if (sessionCache.has(sessionId)) {
        return sessionCache.get(sessionId);
    }

    // The durable AgentSessionStore owns user-visible history. This temporary
    // cache only supplies provider context during one generated turn.
    const newSession = {
        messages: [],
        topic: null,
        createdAt: new Date(),
    };
    sessionCache.set(sessionId, newSession);
    return newSession;
}

/**
 * Delete a chat session
 * @param {string} sessionId - Session to delete
 * @returns {boolean} Whether session existed and was deleted
 */
export function deleteSession(sessionId) {
    return sessionCache.delete(sessionId);
}

// ============================================================================
// CHAT FUNCTIONS
// ============================================================================

/**
 * Agent 专用：豆包文本流式回复（独立于 server/providers）
 */
export async function sendMessageStream({ sessionId, content, media, nodes, model, modelParams = {}, arkApiKey, openAiApiKey, skillInstructions = '', onToken }) {
    const session = getSession(sessionId);

    // 如果传入了节点，将其存储在 session 中作为当前上下文
    if (nodes && Array.isArray(nodes)) {
        session.currentNodes = nodes;
    }

    // 保留用户原始文本；附件通过多模态 content 单独传入
    const userText = `${content || ''}`.trim() || '请分析我上传的素材。';

    const userMessage = {
        role: 'user',
        content: userText,
        media: Array.isArray(media) ? media.map(m => ({
            type: m?.type,
            url: m?.url,
            base64: m?.base64
        })) : undefined,
        timestamp: new Date().toISOString()
    };
    session.messages.push(userMessage);

    // 构建系统提示词，包含当前节点信息
    let systemPrompt = CHAT_AGENT_SYSTEM_PROMPT;
    if (skillInstructions) systemPrompt += `\n\n${skillInstructions}`;
    if (session.currentNodes && session.currentNodes.length > 0) {
        const nodesContext = session.currentNodes.map(n => 
            `--- 节点记录开始 ---
ID: ${n.id}
类型: ${n.type}
标题: ${n.title || '无标题'}
使用模型: ${n.model || n.imageModel || n.videoModel || n.audioModel || '默认'}
提示词(Prompt): ${n.prompt || '无'}
生成结果(Content): ${n.textContent || '无'}${n.comfyMode ? `\nComfy模式: ${n.comfyMode}` : ''}
--- 节点记录结束 ---`
        ).join('\n\n');
        systemPrompt += `\n\n## 当前画布节点上下文 (共 ${session.currentNodes.length} 个)\n${nodesContext}`;
    }

    // 仅对“本轮用户消息”注入多模态附件，历史轮次按文本回放，避免重复大体积输入
    const latestIndex = session.messages.length - 1;
    const latestUserContent = buildDoubaoContent(
        session.messages[latestIndex]?.content,
        session.messages[latestIndex]?.media,
        { detail: modelParams?.detail }
    );
    const imageCount = latestUserContent.filter(item => item?.type === 'input_image').length;

    // 构建请求消息队列，确保第一条是系统提示词
    const requestInput = [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        ...session.messages.map((msg, index) => {
            if (msg.role === 'user' && index === latestIndex) {
                return {
                    role: 'user',
                    content: latestUserContent
                };
            }
            return {
                role: msg.role,
                content: [{ type: 'input_text', text: contentToText(msg.content) }]
            };
        })
    ];
    console.log(`[Agent][Doubao] context injected: nodes=${session.currentNodes?.length || 0}, images=${imageCount}`);

    const doubaoModels = new Set([
        'doubao-seed-2-0-mini-260215',
        'doubao-seed-2-0-mini-260428',
        'doubao-seed-2-0-pro-260215'
    ]);
    const gptModels = new Set(['gpt-5.4-mini', 'gpt-5.4']);

    const requestedModel = String(model || '').trim();
    const finalModel = (doubaoModels.has(requestedModel) || gptModels.has(requestedModel))
        ? requestedModel
        : 'doubao-seed-2-0-mini-260428';
    const isGptModel = gptModels.has(finalModel);

    const thinkingParameters = !isGptModel ? doubaoThinkingParameters(modelParams?.reasoning, true) : {};
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 70_000);

    const requestBody = isGptModel
        ? {
            model: finalModel,
            stream: true,
            messages: [
                { role: 'system', content: systemPrompt },
                ...session.messages.map((msg, index) => {
                    if (msg.role === 'user' && index === latestIndex) {
                        return { role: 'user', content: toOpenAIContentBlocks(latestUserContent) };
                    }
                    return { role: msg.role, content: contentToText(msg.content) };
                })
            ],
            temperature: typeof modelParams?.temperature === 'number' ? modelParams.temperature : 0.7
        }
        : {
            model: finalModel,
            input: requestInput,
            stream: true,
            temperature: typeof modelParams?.temperature === 'number' ? modelParams.temperature : 0.7
        };

    if (!isGptModel) Object.assign(requestBody, thinkingParameters);

    if (typeof modelParams?.top_p === 'number') requestBody.top_p = modelParams.top_p;
    if (typeof modelParams?.max_output_tokens === 'number') requestBody.max_output_tokens = modelParams.max_output_tokens;
    if (!isGptModel && modelParams?.web_search === true) requestBody.tools = [{ type: 'web_search' }];

    const requestUrl = isGptModel ? resolveOpenAiAgentUrl(finalModel) : 'https://ark.cn-beijing.volces.com/api/v3/responses';
    const authKey = isGptModel ? openAiApiKey : arkApiKey;

    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authKey}`
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
    });
    clearTimeout(timeoutId);

    if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText || `${isGptModel ? 'OpenAI' : '豆包'}流式请求失败: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;

            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            let parsed;
            try {
                parsed = JSON.parse(payload);
            } catch {
                continue;
            }

            const rawDelta = parsed?.choices?.[0]?.delta?.content;
            const gptToken = Array.isArray(rawDelta)
                ? rawDelta.map((p) => p?.text || '').join('')
                : (typeof rawDelta === 'string' ? rawDelta : '');
            const doubaoToken =
                parsed?.delta?.output_text ||
                parsed?.output_text?.delta ||
                (parsed?.type === 'response.output_text.delta' ? parsed?.delta : '') ||
                '';
            const token = gptToken || doubaoToken;
            if (token) {
                fullText += token;
                if (typeof onToken === 'function') onToken(token);
            }
        }
    }

    const aiResponse = {
        role: 'assistant',
        content: fullText || '',
        timestamp: new Date().toISOString()
    };
    session.messages.push(aiResponse);

    let topic = session.topic;
    if (session.messages.length === 2 && !session.topic) {
        const base = String(content || '').trim();
        topic = (base || 'New Chat').slice(0, 12);
        session.topic = topic;
    }

    return {
        response: fullText,
        topic,
        messageCount: session.messages.length,
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    getSession,
    deleteSession,
    sendMessageStream,
};
