/**
 * tosSigner.js
 * 火山引擎对象存储 (TOS) V4 签名实现工具
 * 参考: https://www.volcengine.com/docs/6349/1223707?lang=zh
 */
import crypto from 'crypto';

/**
 * 计算数据哈希值 (SHA256)
 */
function hashSHA256(data) {
    const content = data || '';
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 计算 HMAC-SHA256
 */
function hmacSHA256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * 生成派生密钥 (Signing Key)
 */
function getSigningKey(secretKey, date, region, service) {
    const kDate = hmacSHA256(secretKey, date);
    const kRegion = hmacSHA256(kDate, region);
    const kService = hmacSHA256(kRegion, service);
    const kSigning = hmacSHA256(kService, 'request');
    return kSigning;
}

/**
 * TOS V4 签名函数
 * @param {Object} options 签名参数
 * @param {string} options.accessKey - 火山引擎 AK
 * @param {string} options.secretKey - 火山引擎 SK
 * @param {string} options.method - 请求方法 (GET, PUT, POST, DELETE 等)
 * @param {string} options.endpoint - TOS 访问域名 (如 tos-s3-cn-beijing.volces.com)
 * @param {string} options.region - 地域 (如 cn-beijing)
 * @param {string} options.bucket - 存储桶名称
 * @param {string} options.object - 对象名称 (Key)
 * @param {Object} options.headers - 额外的请求头
 * @param {Object} options.query - 查询参数
 * @param {Buffer|string} options.body - 请求体内容
 */
export function signTOSV4({
    accessKey,
    secretKey,
    method = 'GET',
    endpoint,
    region,
    bucket = '',
    object = '',
    headers = {},
    query = {},
    body = ''
}) {
    const SERVICE = 'tos';
    const now = new Date();
    // 格式: YYYYMMDDTHHMMSSZ
    const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = xDate.slice(0, 8);

    // 1. 规范化路径和参数
    const host = endpoint.replace(/^https?:\/\//, '');
    
    // 虚拟托管风格 (Virtual Hosted-Style): bucket 在域名中，path 只包含 object
    // 路径风格 (Path-Style): path 包含 /bucket/object
    const isVirtualHosted = host.startsWith(`${bucket}.`);
    const path = isVirtualHosted ? `/${object}` : `/${bucket}${bucket && object ? '/' : ''}${object}`;
    
    // 对路径进行二次编码
    const canonicalUri = path.split('/').map(p => encodeURIComponent(p)).join('/').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
    
    const sortedQueryKeys = Object.keys(query).sort();
    const queryString = sortedQueryKeys
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join('&');

    // 2. 规范化请求头
    const payloadHash = body ? hashSHA256(body) : hashSHA256('');
    const canonicalHeadersMap = {
        'host': host,
        'x-tos-date': xDate,
        ...(body ? { 'x-tos-content-sha256': payloadHash } : {}),
        ...Object.keys(headers).reduce((acc, key) => {
            acc[key.toLowerCase()] = String(headers[key]).trim();
            return acc;
        }, {})
    };

    const signedHeadersList = Object.keys(canonicalHeadersMap).sort();
    const canonicalHeaders = signedHeadersList
        .map(key => `${key}:${canonicalHeadersMap[key]}\n`)
        .join('');
    const signedHeaders = signedHeadersList.join(';');

    // 3. 计算 Payload Hash
    // 已在上面计算过 payloadHash

    // 4. 构建规范化请求 (Canonical Request)
    const canonicalRequest = [
        method.toUpperCase(),
        canonicalUri,
        queryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    // 5. 构建待签名字符串 (String to Sign)
    const credentialScope = `${date}/${region}/${SERVICE}/request`;
    const stringToSign = [
        'TOS4-HMAC-SHA256',
        xDate,
        credentialScope,
        hashSHA256(canonicalRequest)
    ].join('\n');

    // 6. 计算签名
    const signingKey = getSigningKey(secretKey, date, region, SERVICE);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    // 7. 生成 Authorization 头
    const authorization = `TOS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        url: `https://${host}${path}${queryString ? '?' + queryString : ''}`,
        headers: {
            ...headers,
            'Host': host,
            'x-tos-date': xDate,
            'Authorization': authorization,
            ...(body ? { 'x-tos-content-sha256': payloadHash } : {})
        }
    };
}
