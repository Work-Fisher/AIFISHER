/**
 * 分辨率与比例映射表
 * 用于将用户在 UI 选择的 "1K/2K/4K" 和 "1:1/16:9" 等转换为模型要求的具体像素值
 */

export const SEEDREAM_V5_PRO_ASPECT_RATIOS = Object.freeze([
    '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4',
    '9:16', '16:9', '1:2', '2:1', '1:4', '4:1', '1:8', '8:1', '21:9',
]);

// Seedream 5.0 Pro 官方支持 1K/2K、总像素 921,600–4,624,220、比例 1/16–16。
// 常用比例使用官方表；额外画布比例按同一像素预算计算并对齐到 16px。
// https://docs.byteplus.com/api/docs/ModelArk/1824121
const SEEDREAM_V5_PRO_COMMON_DIMENSIONS = Object.freeze({
    '1K': {
        '1:1': { width: 1024, height: 1024 },
        '4:3': { width: 1152, height: 864 },
        '3:4': { width: 864, height: 1152 },
        '16:9': { width: 1424, height: 800 },
        '9:16': { width: 800, height: 1424 },
        '3:2': { width: 1248, height: 832 },
        '2:3': { width: 832, height: 1248 },
        '21:9': { width: 1568, height: 672 },
    },
    '2K': {
        '1:1': { width: 2048, height: 2048 },
        '4:3': { width: 2368, height: 1776 },
        '3:4': { width: 1776, height: 2368 },
        '16:9': { width: 2816, height: 1584 },
        '9:16': { width: 1584, height: 2816 },
        '3:2': { width: 2496, height: 1664 },
        '2:3': { width: 1664, height: 2496 },
        '21:9': { width: 3136, height: 1344 },
    },
});

const SEEDREAM_V5_PRO_TARGET_PIXELS = Object.freeze({
    '1K': 1024 * 1024,
    '2K': 2048 * 2048,
});
const SEEDREAM_V5_PRO_MIN_PIXELS = 1280 * 720;
const SEEDREAM_V5_PRO_MAX_PIXELS = Math.floor(2048 * 2048 * 1.1025);

function greatestCommonDivisor(left, right) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

export function getSeedreamV5ProDimensions(resolution, aspectRatio) {
    const normalizedResolution = String(resolution || '').trim().toUpperCase();
    const normalizedAspectRatio = String(aspectRatio || '').trim();
    const targetPixels = SEEDREAM_V5_PRO_TARGET_PIXELS[normalizedResolution];
    const ratioMatch = /^(\d{1,3}):(\d{1,3})$/u.exec(normalizedAspectRatio);
    if (!targetPixels || !ratioMatch) return null;

    let widthRatio = Number(ratioMatch[1]);
    let heightRatio = Number(ratioMatch[2]);
    if (!widthRatio || !heightRatio || widthRatio / heightRatio < 1 / 16 || widthRatio / heightRatio > 16) {
        return null;
    }
    const divisor = greatestCommonDivisor(widthRatio, heightRatio);
    widthRatio /= divisor;
    heightRatio /= divisor;

    const official = SEEDREAM_V5_PRO_COMMON_DIMENSIONS[normalizedResolution]?.[normalizedAspectRatio];
    if (official) return { ...official };

    let multiplier = Math.max(
        1,
        Math.round(Math.sqrt(targetPixels / (16 * 16 * widthRatio * heightRatio))),
    );
    let width = 16 * widthRatio * multiplier;
    let height = 16 * heightRatio * multiplier;
    while (width * height < SEEDREAM_V5_PRO_MIN_PIXELS) {
        multiplier += 1;
        width = 16 * widthRatio * multiplier;
        height = 16 * heightRatio * multiplier;
    }
    while (width * height > SEEDREAM_V5_PRO_MAX_PIXELS && multiplier > 1) {
        multiplier -= 1;
        width = 16 * widthRatio * multiplier;
        height = 16 * heightRatio * multiplier;
    }
    return { width, height };
}

export const MODEL_RESOLUTION_MAP = {
    // 即梦图片 3.0
    'jimeng_t2i_v30': {
        '1K': { 
            '1:1':   { width: 1328, height: 1328 },
            '4:3':   { width: 1472, height: 1104 },
            '3:4':   { width: 1104, height: 1472 },
            '3:2':   { width: 1584, height: 1056 },
            '2:3':   { width: 1056, height: 1584 },
            '16:9':  { width: 1664, height: 936 },
            '9:16':  { width: 936, height: 1664 },
            '21:9':  { width: 2016, height: 864 },
        },
        '2K': {
            '1:1':  { width: 2048, height: 2048 },
            '4:3':  { width: 2304, height: 1728 },
            '3:4':  { width: 1728, height: 2304 },
            '3:2':  { width: 2496, height: 1664 },
            '2:3':  { width: 1664, height: 2496 },
            '16:9': { width: 2560, height: 1440 },
            '9:16': { width: 1440, height: 2560 }, 
            '21:9': { width: 3024, height: 1296 },
        }
    },
    // 即梦图片 3.1
    'jimeng_t2i_v31': {
        '1K': {
            '1:1':  { width: 1328, height: 1328 },
            '4:3':  { width: 1472, height: 1104 },
            '3:4':  { width: 1104, height: 1472 },
            '3:2':  { width: 1584, height: 1056 },
            '2:3':  { width: 1056, height: 1584 },
            '16:9': { width: 1664, height: 936 },
            '9:16': { width: 936, height: 1664 },
            '21:9': { width: 2016, height: 864 },
        },
        '2K': {
            '1:1':  { width: 2048, height: 2048 },
            '4:3':  { width: 2304, height: 1728 },
            '3:4':  { width: 1728, height: 2304 },
            '3:2':  { width: 2496, height: 1664 },
            '2:3':  { width: 1664, height: 2496 },
            '16:9': { width: 2560, height: 1440 },
            '9:16': { width: 1440, height: 2560 }, 
            '21:9': { width: 3024, height: 1296 },
        }
    },
    'doubao-seedream-4-0-250828': {
        '1K': {
            '1:1':  { width: 1024, height: 1024 },
            '4:3':  { width: 1152, height: 864 },
            '3:4':  { width: 864, height: 1152 },
            '16:9': { width: 1280, height: 720 },
            '9:16': { width: 720, height: 1280 },
            '3:2':  { width: 1248, height: 832 },
            '2:3':  { width: 832, height: 1248 },
            '21:9': { width: 1512, height: 648 },
        },
        '2K': {
            '1:1':  { width: 2048, height: 2048 },
            '4:3':  { width: 2304, height: 1728 },
            '3:4':  { width: 1728, height: 2304 },
            '16:9': { width: 2848, height: 1600 },
            '9:16': { width: 1600, height: 2848 },
            '3:2':  { width: 2496, height: 1664 },
            '2:3':  { width: 1664, height: 2496 },
            '21:9': { width: 3136, height: 1344 },
        },
        '4K': {
            '1:1':  { width: 4096, height: 4096 },
            '3:4':  { width: 3520, height: 4704 },
            '4:3':  { width: 4704, height: 3520 },
            '16:9': { width: 5504, height: 3040 },
            '9:16': { width: 3040, height: 5504 },
            '2:3':  { width: 3328, height: 4992 },
            '3:2':  { width: 4992, height: 3328 },
            '21:9': { width: 6240, height: 2656 },
        }
    },
    'doubao-seedream-4-5-251128': {
        '2K': {
            '1:1':  { width: 2048, height: 2048 },
            '4:3':  { width: 2304, height: 1728 },
            '3:4':  { width: 1728, height: 2304 },
            '16:9': { width: 2848, height: 1600 },
            '9:16': { width: 1600, height: 2848 },
            '3:2':  { width: 2496, height: 1664 },
            '2:3':  { width: 1664, height: 2496 },
            '21:9': { width: 3136, height: 1344 },
        },
        '4K': {
            '1:1':  { width: 4096, height: 4096 },
            '3:4':  { width: 3520, height: 4704 },
            '4:3':  { width: 4704, height: 3520 },
            '16:9': { width: 5504, height: 3040 },
            '9:16': { width: 3040, height: 5504 },
            '2:3':  { width: 3328, height: 4992 },
            '3:2':  { width: 4992, height: 3328 },
            '21:9': { width: 6240, height: 2656 },
        }
    },
    'doubao-seedream-5-0-260128': {
        '2K': {
            '1:1':  { width: 2048, height: 2048 },
            '4:3':  { width: 2304, height: 1728 },
            '3:4':  { width: 1728, height: 2304 },
            '16:9': { width: 2848, height: 1600 },
            '9:16': { width: 1600, height: 2848 },
            '3:2':  { width: 2496, height: 1664 },
            '2:3':  { width: 1664, height: 2496 },
            '21:9': { width: 3136, height: 1344 },
        },
        '4K': {
            '1:1':  { width: 3072, height: 3072 },
            '3:4':  { width: 2592, height: 3456 },
            '4:3':  { width: 3456, height: 2592 },
            '16:9': { width: 4096, height: 2304 },
            '9:16': { width: 2304, height: 4096 },
            '2:3':  { width: 2496, height: 3744 },
            '3:2':  { width: 3744, height: 2496 },
            '21:9': { width: 4704, height: 2016 },
        }
    },
    'gpt-image-2': {
        '1K': {
            '1:1':   { width: 1024, height: 1024 },
            '16:9':  { width: 1088, height: 608  },
            '9:16':  { width: 608,  height: 1088 }, 
            '4:3':   { width: 1024, height: 768  },
            '3:4':   { width: 768,  height: 1024 },
            '3:2':   { width: 1024, height: 688  },
            '2:3':   { width: 688,  height: 1024 },
            '5:4':   { width: 1024, height: 816  },
            '4:5':   { width: 816,  height: 1024 },
            '21:9':  { width: 1248, height: 528  },
            '2:1':   { width: 1152, height: 576  },
        },
        '2K': {
            '1:1':   { width: 2048, height: 2048 },
            '16:9':  { width: 2048, height: 1152 },
            '9:16':  { width: 1152, height: 2048 },
            '4:3':   { width: 2048, height: 1536 },
            '3:4':   { width: 1536, height: 2048 },
            '3:2':   { width: 1536, height: 1024 },
            '2:3':   { width: 1024, height: 1536 },
            '5:4':   { width: 2560, height: 2048 },
            '4:5':   { width: 2048, height: 2560 },
            '21:9':  { width: 2688, height: 1152 },
            '2:1':   { width: 2304, height: 1152 },
        },
        '4K': {
            '1:1':   { width: 2880, height: 2880 },
            '16:9':  { width: 3840, height: 2160 },
            '9:16':  { width: 2160, height: 3840 },
            '4:3':   { width: 3312, height: 2480 },
            '3:4':   { width: 2480, height: 3312 },
            '3:2':   { width: 3520, height: 2336 },
            '2:3':   { width: 2336, height: 3520 },
            '5:4':   { width: 3216, height: 2560 },
            '4:5':   { width: 2560, height: 3216 },
            '21:9':  { width: 3840, height: 1648 },
            '2:1':   { width: 3840, height: 1920 },
        }
    },
};

/**
 * 根据模型、分辨率等级和比例获取具体的宽高
 * @param {string} modelId 模型ID
 * @param {string} resolution 分辨率等级 (如 '1K', '2K')
 * @param {string} aspectRatio 比例 (如 '1:1', '16:9')
 * @returns {{width: number, height: number}}
 */
export function getModelDimensions(modelId, resolution, aspectRatio) {
    // 默认兜底值
    const defaultDim = { width: 1024, height: 1024 };
    
    const modelMap = MODEL_RESOLUTION_MAP[modelId];
    if (!modelMap) return defaultDim;

    const resMap = modelMap[resolution];
    if (!resMap) {
        // 如果找不到对应分辨率等级，尝试找该模型下的第一个可用等级
        const firstRes = Object.values(modelMap)[0];
        return firstRes?.[aspectRatio] || defaultDim;
    }

    return resMap[aspectRatio] || Object.values(resMap)[0] || defaultDim;
}
