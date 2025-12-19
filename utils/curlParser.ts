
import { CurlConfig } from '../types';

export const parseCurl = (curlString: string): CurlConfig => {
  const config: CurlConfig = {
    url: '',
    method: 'GET',
    headers: {},
    body: null,
  };

  // 0. Cleanup: Handle multiline cURLs with backslashes
  const cleanCurl = curlString.replace(/\\\n/g, ' ').replace(/\\\r\n/g, ' ').trim();

  // 1. Extract URL (Handles various quoting styles and --location)
  // Look for strings starting with http inside quotes or as standalone words
  const urlMatch = cleanCurl.match(/(?:["'])(https?:\/\/[^"']+)(?:["'])|(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    config.url = (urlMatch[1] || urlMatch[2]).split(' ')[0].replace(/["']/g, '');
  }

  // 2. Extract Method
  const methodMatch = cleanCurl.match(/(?:-X|--request)\s+["']?(\w+)["']?/i);
  if (methodMatch) {
    config.method = methodMatch[1].toUpperCase();
  } else if (cleanCurl.includes('-d ') || cleanCurl.includes('--data') || cleanCurl.includes('--data-raw')) {
    config.method = 'POST';
  }

  // 3. Extract Headers
  const headerRegex = /(?:-H|--header)\s+["']?([^"']+)["']?/g;
  let hMatch;
  while ((hMatch = headerRegex.exec(cleanCurl)) !== null) {
    const headerStr = hMatch[1];
    const colonIndex = headerStr.indexOf(':');
    if (colonIndex > -1) {
      const key = headerStr.substring(0, colonIndex).trim();
      const value = headerStr.substring(colonIndex + 1).trim();
      config.headers[key] = value;
    }
  }

  // 4. Extract Body (Handles -d, --data, --data-raw, --data-binary)
  const bodyRegex = /(?:-d|--data|--data-raw|--data-binary|--data-urlencode)\s+(?:["'](\{[\s\S]+?\}|[^"']+)["']|(\{[\s\S]+?\}|[^"'\s]+))/;
  const bodyMatch = cleanCurl.match(bodyRegex);
  if (bodyMatch) {
    config.body = bodyMatch[1] || bodyMatch[2];
    
    // Auto-detect JSON if not explicitly set
    if (!Object.keys(config.headers).some(k => k.toLowerCase() === 'content-type')) {
      if (config.body?.trim().startsWith('{') || config.body?.trim().startsWith('[')) {
        config.headers['Content-Type'] = 'application/json';
      }
    }
  }

  return config;
};

export const substituteParams = (template: string, params: Record<string, string>): string => {
  if (!template) return '';
  let result = template;
  
  // Sort keys by length descending to prevent partial replacement
  const sortedKeys = Object.keys(params).sort((a, b) => b.length - a.length);

  sortedKeys.forEach((key) => {
    const value = String(params[key]);
    
    // Replacement patterns: {{key}}, {key}, :key
    const patterns = [
      new RegExp(`{{\\s*${key}\\s*}}`, 'gi'),
      new RegExp(`{\\s*${key}\\s*}`, 'gi'),
      new RegExp(`:${key}(?![a-zA-Z0-9_])`, 'g')
    ];

    patterns.forEach(pattern => {
      result = result.replace(pattern, value);
    });
  });
  
  return result;
};
