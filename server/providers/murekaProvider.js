/**
 * murekaProvider.js
 * 封装 Mureka 音频生成逻辑（独立厂商）
 */
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs } from './providerKit.js';

/**
 * Mureka 音频生成处理器
 */
export const MurekaAudioProvider = {
    async generateAudio(params, config) {
        const { MUREKA_API_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, lyrics, audioMode, audioModel, generateCount, url: finalUrl } = params;

        // 校验 API Key
        if (!MUREKA_API_KEY) throw new Error('MUREKA_API_KEY 未配置。');

        // 根据模式选择提交地址（纯音乐固定走 instrumental）
        const submitUrl = audioMode === 'instrumental'
            ? 'https://api.mureka.cn/v1/instrumental/generate'
            : (finalUrl || 'https://api.mureka.cn/v1/song/generate');

        // 构建请求体
        const body = {
            model: audioModel || 'mureka-6',
            prompt: prompt || '',
            n: Math.max(1, Math.min(1, Number(generateCount) || 1))
        };

        // 歌词模式补充 lyrics 字段（与 prompt 分离）
        if (audioMode === 'lyrics-to-music') {
            body.lyrics = (lyrics || '').trim();
        }

        // 提交任务
        const submitResult = await submitJsonWithLogs({
            url: submitUrl,
            fetchOptions: buildJsonFetchOptions({
                headers: { 'Authorization': `Bearer ${MUREKA_API_KEY}` },
                body
            }),
            nodeId,
            logsDir: LOGS_DIR,
            modelId: audioModel || 'mureka-6',
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body
        });

        // 提取任务 ID
        const taskId = submitResult?.id;
        if (!taskId) {
            throw new Error(`Mureka 提交失败: ${submitResult?.error?.message || submitResult?.message || '未返回任务ID'}`);
        }

        // 轮询任务状态
        const pollUrl = `https://api.mureka.cn/v1/song/query/${taskId}`;
        const audioUrl = await BaseProvider.pollTask({
            interval: 4000,
            pollFn: async () => {
                const fetchOptions = {};
                BaseProvider.injectProxy(fetchOptions, params.useProxy);

                const resp = await BaseProvider.fetch(pollUrl, {
                    ...fetchOptions,
                    headers: { 'Authorization': `Bearer ${MUREKA_API_KEY}` }
                });

                const data = await resp.json();

                if (!resp.ok) {
                    return { error: data?.error?.message || `查询失败: HTTP ${resp.status}` };
                }

                const status = String(data?.status || '').toLowerCase();

                if (status === 'succeeded' || status === 'success' || status === 'completed') {
                    const candidateUrl =
                        data?.audio_url ||
                        data?.url ||
                        data?.result?.audio_url ||
                        data?.result?.url ||
                        data?.data?.audio_url ||
                        data?.data?.url;

                    if (!candidateUrl) return { error: '任务已完成但未返回音频地址' };
                    return { done: true, data: candidateUrl };
                }

                if (status === 'failed' || status === 'error' || status === 'canceled') {
                    return { error: data?.error?.message || data?.message || '音频生成失败' };
                }

                return { done: false };
            }
        });

        // 下载音频并返回 Buffer
        const audioBuffer = await BaseProvider.asyncDownloadToBuffer(audioUrl, params.useProxy);
        return { buffer: audioBuffer, format: 'mp3' };
    }
};