/**
 * gptProvider.js
 * 封装 OpenAI GPT 系列模型的图像生成逻辑
 */
import FormData from 'form-data';
import { getModelDimensions } from '../utils/resolutionMapper.js';
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs } from './providerKit.js';

/**
 * GPT 文本多模态处理器（Chat Completions）
 */
export const GptTextProvider = {
    async generateText(params, config) {
        const { OPENAI_API_KEY, LOGS_DIR } = config;
        const { nodeId, prompt, textModel, detail, url: finalUrl } = params;

        if (!OPENAI_API_KEY) throw new Error("OpenAI API Key 未配置。");
        if (!finalUrl) throw new Error(`[GPT-Text-Provider] 模型 ${textModel} 的端点地址未配置。`);

        const { images: allImages, audios: allAudios } = BaseProvider.getAssets(params);
        const content = [];

        // 文本输入
        content.push({ type: 'text', text: prompt || '' });

        // 图片输入（统一使用 base64 data URL）
        allImages.forEach((img) => {
            if (typeof img === 'string' && img.startsWith('data:image/')) {
                content.push({ type: 'image_url', image_url: { url: img, detail: detail || 'low' } });
            }
        });

        // 音频输入（统一使用 base64，并映射为 input_audio）
        for (const audio of allAudios) {
            let dataUrl = audio;
            if (typeof dataUrl === 'string' && /^https?:\/\//i.test(dataUrl)) {
                const buffer = await BaseProvider.asyncDownloadToBuffer(dataUrl, params.useProxy);
                const mime = BaseProvider.getMimeType(dataUrl);
                dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
            }

            const match = String(dataUrl).match(/^data:audio\/([^;]+);base64,(.+)$/i);
            if (!match) continue;

            const mimeSubType = match[1].toLowerCase();
            const rawBase64 = match[2];
            const format = mimeSubType.includes('wav') ? 'wav' : mimeSubType.includes('ogg') ? 'ogg' : mimeSubType.includes('webm') ? 'webm' : 'mp3';

            content.push({
                type: 'input_audio',
                input_audio: {
                    data: rawBase64,
                    format
                }
            });
        }

        const body = {
            model: textModel,
            stream: false,
            messages: [{ role: 'user', content }]
        };

        const fetchOptions = buildJsonFetchOptions({
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body
        });

        const logBody = {
            ...body,
            messages: [{
                role: 'user',
                content: content.map((item) => {
                    if (item.type === 'image_url') return { ...item, image_url: { ...item.image_url, url: '[Base64 Image]' } };
                    if (item.type === 'input_audio') return { ...item, input_audio: { ...item.input_audio, data: '[Base64 Audio]' } };
                    return item;
                })
            }]
        };

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: textModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody
        });

        const messageContent = result?.choices?.[0]?.message?.content;
        const text = typeof messageContent === 'string'
            ? messageContent
            : Array.isArray(messageContent)
                ? messageContent.map((part) => part?.text || '').join('\n').trim()
                : '';

        if (!text) {
            throw new Error(`OpenAI 文本响应中未包含内容: ${JSON.stringify(result)}`);
        }

        return { text };
    }
};

/**
 * GPT 图像生成处理器
 */
export const GptImageProvider = {
    async generateImage(params, config) {
        const { OPENAI_API_KEY, LOGS_DIR } = config;
        const { 
            nodeId, prompt, aspectRatio, resolution, imageModel, 
            generateCount, url: passedUrl, quality,
            mappingKey 
        } = params;

        if (!OPENAI_API_KEY) throw new Error("OpenAI API Key 未配置。");

        // 获取所有关联资产，并过滤空值/非法值
        const { images: allImages } = BaseProvider.getAssets(params);
        const cleanImages = allImages
            .filter(img => typeof img === 'string' && img.trim())
            .map(img => img.includes('base64,') ? img.split('base64,')[1] : img);

        // 模式识别
        const currentMode = params.imageMode;

        // 优先使用 mappingKey 进行分辨率映射，确保即便 MODEL_ID 被覆盖也能找到对应的像素配置
        const { width, height } = getModelDimensions(mappingKey || imageModel, resolution, aspectRatio);
        const finalCount = Math.min(parseInt(generateCount) || 1, 4);
        const finalSize = `${width}x${height}`;
        const isEditMode = currentMode === 'image-inpainting' || currentMode === 'image-to-image';
        // 统一在提示词前添加生成数量引导（默认 1 张）
        const finalPrompt = `生成${finalCount}张图\n${prompt}`;

        // 确定最终请求的 URL (完全信任从配置或环境变量传入的完整地址)
        let finalUrl = passedUrl;
        
        if (!finalUrl) {
            throw new Error(`[GPT-Provider] 模型 ${imageModel} 的端点地址未配置。请检查设置或模型配置文件。`);
        }
        
        let fetchOptions = {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            }
        };

        let logBody;

        if (isEditMode) {
            if (cleanImages.length === 0) {
                throw new Error('GPT 图生图/遮罩修图至少需要一张参考图片。');
            }

            // 图像编辑模式必须使用 multipart/form-data，并遵循 OpenAI 官方 image[] 上传格式
            const form = new FormData();

            // 构造可读的日志主体
            logBody = {
                model: imageModel,
                prompt: finalPrompt,
                n: finalCount,
                size: finalSize
            };

            form.append('model', String(imageModel));
            cleanImages.forEach((base64, index) => {
                const imageBuffer = Buffer.from(base64, 'base64');
                form.append('image[]', imageBuffer, { filename: `ref_${index}.png`, contentType: 'image/png' });
            });
            logBody.images = cleanImages.map((_, i) => `[Binary Reference ${i}]`);

            if (currentMode === 'image-inpainting') {
                // 遮罩模式：在 image[] 基础上额外补充 mask
                // 兼容逻辑：若未传第二张遮罩图，则回退使用第一张主图作为遮罩图
                const maskImageBase64 = cleanImages[1] || cleanImages[0];

                if (maskImageBase64) {
                    const maskBuffer = Buffer.from(maskImageBase64, 'base64');
                    form.append('mask', maskBuffer, { filename: 'mask.png', contentType: 'image/png' });
                    logBody.mask = cleanImages[1] ? "[Binary Data]" : "[Binary Data - Fallback From image]";
                }
            }

            form.append('prompt', finalPrompt);
            form.append('n', String(finalCount));
            form.append('size', finalSize);

            // 只有当质量不是 auto 时才传递
            if (quality && quality !== 'auto') {
                form.append('quality', String(quality));
                logBody.quality = quality;
            }

            // undici 不直接支持 form-data 对象，这里改为 buffer，并显式补充长度头
            fetchOptions.body = form.getBuffer();
            Object.assign(fetchOptions.headers, form.getHeaders());
            try {
                fetchOptions.headers['Content-Length'] = String(form.getLengthSync());
            } catch (error) {
                console.warn(`[GPT-Provider] Failed to calculate multipart content length: ${error.message}`);
            }
        } else {
            // 文生图模式使用标准 JSON
            const bodyObj = {
                model: imageModel,
                prompt: finalPrompt,
                n: finalCount,
                size: finalSize,
                ...(quality && quality !== 'auto' ? { quality } : {})
            };
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(bodyObj);
            logBody = bodyObj;
        }

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: imageModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody
        });

        const dataList = result.data || [];
        if (dataList.length === 0) {
            throw new Error("OpenAI 响应中未包含图像数据。");
        }

        // 转换返回的结果为 Buffer
        const processedResults = await Promise.all(dataList.map(async (item) => {
            // 优先处理 Base64 格式 (某些代理或本地模型默认返回此格式)
            if (item.b64_json) {
                return {
                    buffer: Buffer.from(item.b64_json, 'base64'),
                    format: 'png' // OpenAI Base64 默认为 png
                };
            }

            const resultUrl = item.url;
            if (!resultUrl) return null;

            // 使用基类提供的带代理支持的下载逻辑
            const buffer = await BaseProvider.asyncDownloadToBuffer(resultUrl, params.useProxy);
            return {
                buffer: buffer,
                format: resultUrl.toLowerCase().includes('.png') ? 'png' : 'jpg'
            };
        }));

        const finalResults = processedResults.filter(r => r !== null);
        return finalResults.length === 1 ? finalResults[0] : finalResults;
    }
};
