export const agentDocumentExtensions = ['txt', 'md', 'markdown', 'docx', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'log', 'srt', 'vtt'];
export const agentDocumentAccept = agentDocumentExtensions.map(extension => `.${extension}`).join(',');
export const isAgentDocument = name => agentDocumentExtensions.includes(String(name).split('.').at(-1).toLowerCase());
