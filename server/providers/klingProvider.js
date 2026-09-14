/**
 * klingProvider.js
 * 封装可灵 AI (Kling) 的生成逻辑
 */
import crypto from 'crypto';
import { BaseProvider } from './baseProvider.js';
import { buildJsonFetchOptions, submitJsonWithLogs } from './providerKit.js';

/**
 * 生成可灵 API 所需的 JWT Token
 */
function generateKlingToken(accessKey, secretKey) {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: accessKey,
        exp: now + 1800, // 有效时间 30 分钟
        nbf: now - 5     // 开始生效时间，当前时间 - 5秒
    };

    const base64Encode = (obj) => {
        return Buffer.from(JSON.stringify(obj))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    };
    
    const parts = [base64Encode(header), base64Encode(payload)];
    const stringToSign = parts.join('.');
    
    const signature = crypto
        .createHmac('sha256', secretKey)
        .update(stringToSign)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    
    return `${stringToSign}.${signature}`;
}

/**
 * 构建可灵 V3 请求体
 */
function buildKlingV3Body({ prompt, mode, duration, aspectRatio, videoMode, allImages, cleanImages, isSoundOn, videoModel, character_orientation, motionVideoUrl }) {
    const body = {
        model_name: videoModel || 'kling-v3',
        prompt,
        mode: mode || 'std',
        duration: String(duration || 5),
        aspect_ratio: aspectRatio || '16:9',
        watermark_info: { enabled: false },
        sound: isSoundOn ? 'on' : 'off'
    };

    if (videoMode === 'motion-control') {
        if (cleanImages.length < 1) throw new Error('Kling V3 动作控制至少需要 1 张图片。');
        // 动作控制模式下，视频输入必须是网络 URL（不接受 Base64）
        if (!motionVideoUrl) throw new Error('Kling V3 动作控制需要视频网络地址(URL)。');

        body.image_url = allImages?.[0] || cleanImages[0];
        body.video_url = motionVideoUrl;
        body.keep_original_sound = isSoundOn ? 'yes' : 'no';
        body.character_orientation = character_orientation || 'image';
        delete body.sound;
        return body;
    }

    if (videoMode === 'i2v-first-last-frame' || cleanImages.length > 0) {
        body.image = cleanImages[0];
        if (cleanImages[1]) body.image_tail = cleanImages[1];
    }

    return body;
}

/**
 * 构建可灵 Omni 请求体
 */
function buildKlingOmniBody({ prompt, mode, duration, aspectRatio, videoMode, allImages, cleanVideos, isSoundOn }) {
    const omniImageList = allImages.map(img => ({
        image_url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
    }));

    const body = {
        model_name: 'kling-v3-omni',
        prompt,
        mode: mode || 'std',
        duration: String(duration || 5),
        aspect_ratio: aspectRatio || '16:9',
        watermark_info: { enabled: false },
        sound: isSoundOn ? 'on' : 'off'
    };

    if (videoMode === 'omni-image-to-video') {
        if (omniImageList.length === 0) throw new Error('Kling Omni 图生视频至少需要 1 张图片。');
        body.image_list = omniImageList;
    } else if (videoMode === 'omni-first-last-frame') {
        if (omniImageList.length < 2) throw new Error('Kling Omni 首尾帧模式需要 2 张图片。');
        body.image_list = [
            { image_url: omniImageList[0].image_url, type: 'first_frame' },
            { image_url: omniImageList[1].image_url, type: 'end_frame' }
        ];
    } else if (videoMode === 'omni-video-edit' || videoMode === 'omni-video-ref') {
        if (cleanVideos.length === 0) throw new Error('Kling Omni 视频模式至少需要 1 个视频参考。');
        if (omniImageList.length > 0) body.image_list = omniImageList;
        body.video_list = [{
            video_url: cleanVideos[0],
            refer_type: videoMode === 'omni-video-edit' ? 'base' : 'feature',
            keep_original_sound: isSoundOn ? 'yes' : 'no'
        }];
    }
    // omni-text-to-video 使用默认 body

    return body;
}

export const KlingVideoProvider = {
    async generateVideo(params, config) {
        const { KLING_ACCESS_KEY, KLING_SECRET_KEY, LOGS_DIR } = config;
        const { 
            nodeId, prompt, aspectRatio, duration, videoMode, videoModel, url: finalUrl, mode, generate_audio, character_orientation
        } = params;

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            throw new Error("Kling API Key 未配置。");
        }

        const token = generateKlingToken(KLING_ACCESS_KEY, KLING_SECRET_KEY);
        
        // 获取所有关联资产
        const { images: allImages, videos: allVideos } = BaseProvider.getAssets(params);

        // V3 图片字段使用纯 Base64
        const cleanImages = allImages.map(img => img.includes('base64,') ? img.split('base64,')[1] : img);
        // Omni 视频字段
        const cleanVideos = allVideos.filter(Boolean);
        // 优先使用 generate_audio 开关
        const isSoundOn = generate_audio !== false;

        // 仅用于 motion-control：提取“原始入参”中的视频网络 URL（不走 Base64 转换）
        const rawVideoCandidates = [
            ...(Array.isArray(params.videos) ? params.videos : (params.videos ? [params.videos] : [])),
            ...(Array.isArray(params.videoUrl) ? params.videoUrl : (params.videoUrl ? [params.videoUrl] : []))
        ];
        const motionVideoUrl = rawVideoCandidates.find(v => typeof v === 'string' && /^https?:\/\//i.test(v));

        // 按模型分开构建请求体
        const body = videoModel === 'kling-v3-omni'
            ? buildKlingOmniBody({
                prompt,
                mode,
                duration,
                aspectRatio,
                videoMode,
                allImages,
                cleanVideos,
                isSoundOn
            })
            : buildKlingV3Body({
                prompt,
                mode,
                duration,
                aspectRatio,
                videoMode,
                allImages,
                cleanImages,
                cleanVideos,
                isSoundOn,
                videoModel,
                character_orientation,
                motionVideoUrl
            });

        const fetchOptions = buildJsonFetchOptions({
            headers: { 'Authorization': `Bearer ${token}` },
            body
        });

        const result = await submitJsonWithLogs({
            url: finalUrl,
            fetchOptions,
            nodeId,
            logsDir: LOGS_DIR,
            modelId: videoModel,
            projectId: params.projectId,
            useProxy: params.useProxy,
            logBody: body
        });

        if (result.code !== 0) throw new Error(`Kling 提交失败: ${result.message}`);

        const taskId = result.data?.task_id;
        
        // 轮询 URL 也需要基于请求 URL 动态构建 (去掉最后的动作路径，拼接任务 ID)
        // 例如: https://api.klingai.com/v1/videos/text2video -> https://api.klingai.com/v1/videos/text2video/taskId
        const pollUrl = `${finalUrl}/${taskId}`;

        const videoUrl = await BaseProvider.pollTask({
            interval: 5000,
            pollFn: async () => {
                const fetchOptions = {};
                BaseProvider.injectProxy(fetchOptions, params.useProxy);
                const taskResponse = await BaseProvider.fetch(pollUrl, {
                    ...fetchOptions,
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const pollResult = await taskResponse.json();

                if (pollResult.code !== 0) {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { error: `Kling 查询失败: ${pollResult.message}` };
                }

                const status = pollResult.data?.task_status;
                if (status === 'succeed') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { done: true, data: pollResult.data?.task_result?.videos?.[0]?.url };
                } else if (status === 'failed') {
                    BaseProvider.saveDebugLog(LOGS_DIR, `${videoModel}_POLL_RES`, nodeId, pollResult, params.projectId);
                    return { error: `Kling 生成失败: ${pollResult.data?.task_status_msg}` };
                }

                return { done: false };
            }
        });

        const videoBuffer = await BaseProvider.asyncDownloadToBuffer(videoUrl, params.useProxy);
        return { buffer: videoBuffer, format: 'mp4' };
    }
};
