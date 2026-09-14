import { WebSocket } from 'ws';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLocalPath } from '../utils/imageHelpers.js';
import FormData from 'form-data';
import { normalizeLocalComfyServer } from './comfyServerAddress.js';

class ComfyClient {
    constructor() {
        this.clientId = crypto.randomUUID();
        this.ws = null;
    }

    get serverUrl() {
        return normalizeLocalComfyServer(process.env.COMFYUI_SERVER_URL);
    }

    /**
     * 连接到 ComfyUI WebSocket
     */
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = `ws://${this.serverUrl}/ws?clientId=${this.clientId}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log(`[ComfyUI] Connected to ${wsUrl}`);
                resolve();
            });

            this.ws.on('error', (err) => {
                console.error('[ComfyUI] WebSocket Error:', err);
                reject(err);
            });
        });
    }

    /**
     * 将文件上传到 ComfyUI 服务器
     * @param {string} fileUrl - 文件的 Base64 字符串或 URL/路径
     */
    async uploadImage(fileUrl) {
        let fileData;
        const id = crypto.randomUUID();
        let filename = `up_${id}`;

        const formData = new FormData();

        // 1. 使用统一解析器尝试解析本地路径
        const absolutePath = resolveLocalPath(fileUrl);

        // 2. Determine source and get data
        if (fileUrl.startsWith('data:')) {
            const mimeType = fileUrl.match(/data:([^;]+);/)?.[1] || 'image/png';
            const extension = mimeType.split('/')[1] || 'png';
            filename = `${filename}.${extension}`;
            
            const base64Content = fileUrl.includes(',') ? fileUrl.split(',')[1] : fileUrl;
            fileData = Buffer.from(base64Content, 'base64');
            formData.append('image', fileData, { filename });
        } 
        else if (absolutePath && fs.existsSync(absolutePath)) {
            try {
                console.log(`[ComfyUI] Uploading local file: ${absolutePath}`);
                // Use createReadStream for better reliability with FormData
                const stream = fs.createReadStream(absolutePath);
                filename = path.basename(absolutePath);
                formData.append('image', stream, { filename });
            } catch (err) {
                console.error(`[ComfyUI] Local read failed: ${absolutePath}`, err);
                if (fileUrl.startsWith('http')) {
                    const res = await fetch(fileUrl);
                    fileData = await res.buffer();
                    formData.append('image', fileData, { filename });
                } else throw err;
            }
        }
        else if (fileUrl.startsWith('http')) {
            const res = await fetch(fileUrl);
            fileData = await res.buffer();
            const urlObj = new URL(fileUrl);
            filename = path.basename(urlObj.pathname) || filename;
            formData.append('image', fileData, { filename });
        }
        else {
            throw new Error(`Unsupported file source: ${fileUrl.substring(0, 50)}`);
        }
        
        // 3. Send to ComfyUI
        const response = await fetch(`http://${this.serverUrl}/upload/image`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        return result.name;
    }

    /**
     * 提交任务并等待结果
     * @param {object} prompt - 工作流 JSON
     * @param {number} [timeoutMs=120000] - 超时时间（毫秒）
     * @param {string} [outputNodeId] - 期望的输出节点 ID
     */
    async queuePrompt(prompt, timeoutMs = 120000, outputNodeId = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect();
        }

        const response = await fetch(`http://${this.serverUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, client_id: this.clientId })
        });

        if (!response.ok) {
            throw new Error(`Queue prompt failed: ${response.statusText}`);
        }

        const { prompt_id } = await response.json();
        console.log(`[ComfyUI] Task queued: ${prompt_id}`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.ws.off('message', onMessage);
                reject(new Error(`ComfyUI task timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            const onMessage = async (data) => {
                try {
                    if (typeof data === 'string' || data instanceof Buffer || data instanceof ArrayBuffer) {
                        const messageStr = data.toString();
                        if (messageStr.trim().startsWith('{')) {
                            const message = JSON.parse(messageStr);

                            if (message.type === 'executing' && message.data.node === null && message.data.prompt_id === prompt_id) {
                                clearTimeout(timeout);
                                this.ws.off('message', onMessage);
                                const result = await this.getHistory(prompt_id, outputNodeId);
                                resolve(result);
                            }
                        }
                    }
                } catch {
                    console.debug('[ComfyUI] WS Message parse skipped (likely binary data)');
                }
            };

            this.ws.on('message', onMessage);
        });
    }

    /**
     * 获取任务输出结果
     * @param {string} promptId - 任务 ID
     * @param {string} [outputNodeId] - 指定的输出节点 ID
     */
    async getHistory(promptId, outputNodeId = null) {
        const response = await fetch(`http://${this.serverUrl}/history/${promptId}`);
        const history = await response.json();
        
        if (!history[promptId] || !history[promptId].outputs) {
            return null;
        }

        const outputs = history[promptId].outputs;

        // 1. 如果指定了节点 ID，优先获取该节点
        if (outputNodeId && outputs[outputNodeId]) {
            const nodeOutput = outputs[outputNodeId];
            
            // 处理图片
            if (nodeOutput.images) {
                const imgData = nodeOutput.images[0];
                console.log(`[ComfyUI] Returning specified image output node: ${outputNodeId}`);
                return `http://${this.serverUrl}/view?filename=${imgData.filename}&subfolder=${imgData.subfolder}&type=${imgData.type}`;
            }
            
            // 处理音频 (VH-Audio, SaveAudioMP3 等节点)
            if (nodeOutput.audio) {
                const audioData = nodeOutput.audio[0];
                console.log(`[ComfyUI] Returning specified audio output node: ${outputNodeId}`);
                return `http://${this.serverUrl}/view?filename=${audioData.filename}&subfolder=${audioData.subfolder}&type=${audioData.type}`;
            }

            // Video Helper Suite stores video previews in the historical `gifs` field.
            const videoData = nodeOutput.gifs?.[0] || nodeOutput.videos?.[0];
            if (videoData) {
                console.log(`[ComfyUI] Returning specified video output node: ${outputNodeId}`);
                return `http://${this.serverUrl}/view?filename=${videoData.filename}&subfolder=${videoData.subfolder}&type=${videoData.type}`;
            }
        }

        // 2. 否则，遍历所有输出，优先选择 type 为 "output" 的内容
        let fallbackUrl = null;
        for (const nodeId in outputs) {
            const nodeOutput = outputs[nodeId];
            
            // 检查图片
            if (nodeOutput.images) {
                const imgData = nodeOutput.images[0];
                const url = `http://${this.serverUrl}/view?filename=${imgData.filename}&subfolder=${imgData.subfolder}&type=${imgData.type}`;
                if (imgData.type === 'output') return url;
                if (!fallbackUrl) fallbackUrl = url;
            }
            
            // 检查音频
            if (nodeOutput.audio) {
                const audioData = nodeOutput.audio[0];
                const url = `http://${this.serverUrl}/view?filename=${audioData.filename}&subfolder=${audioData.subfolder}&type=${audioData.type}`;
                if (audioData.type === 'output') return url;
                if (!fallbackUrl) fallbackUrl = url;
            }

            const videoData = nodeOutput.gifs?.[0] || nodeOutput.videos?.[0];
            if (videoData) {
                const url = `http://${this.serverUrl}/view?filename=${videoData.filename}&subfolder=${videoData.subfolder}&type=${videoData.type}`;
                if (videoData.type === 'output') return url;
                if (!fallbackUrl) fallbackUrl = url;
            }
        }
        
        return fallbackUrl;
    }
}

export const comfyClient = new ComfyClient();
