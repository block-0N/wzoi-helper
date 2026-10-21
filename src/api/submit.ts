import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://wzoi.cn';

export interface LanguageOption {
    label: string;
    id: number;
    ext: string[];
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
    { label: 'C++', id: 1, ext: ['.cpp', '.cc', '.cxx', '.hpp', '.h'] },
    { label: 'C', id: 0, ext: ['.c'] },
    { label: 'Python', id: 4, ext: ['.py'] },
    { label: 'Pascal', id: 2, ext: ['.pas'] },
];

export interface SubmitResult {
    solutionId: number;
}

/**
 * 提交代码到指定题目
 */
export async function submitSolution(
  problemsetId: string,
  problemId: string,
  code: string,
  language: number,
  cookie: string
): Promise<SubmitResult> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await doSubmit(problemsetId, problemId, code, language, cookie);
    } catch (e: any) {
      lastErr = e;
      // 只有 too_frequent 才重试
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('too_frequent') || msg.includes('过于频繁')) {
        if (attempt < MAX_RETRIES - 1) {
          console.log(
            `[submit] too_frequent，${RETRY_DELAY_MS}ms 后重试（第 ${attempt + 1}/${MAX_RETRIES} 次）`
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error(
          `提交过于频繁，已重试 ${MAX_RETRIES} 次仍被限制。请稍等 30 秒后再试。`
        );
      }
      // 其他错误直接抛
      throw e;
    }
  }

  throw lastErr;
}

async function doSubmit(
  problemsetId: string,
  problemId: string,
  code: string,
  language: number,
  cookie: string
): Promise<SubmitResult> {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const pageUrl = `${BASE_URL}/s/${problemsetId}/${problemId}`;
  const page = await axios.get(pageUrl, {
    headers: {
      'User-Agent': ua,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Cookie: cookie,
    },
    timeout: 15000,
  });

  const $ = cheerio.load(page.data as string);
  const csrf =
    $('meta[name="csrf-token"]').attr('content') ||
    ($('input[name="_token"]').first().val() as string | undefined);
  if (!csrf) throw new Error('题目页找不到 CSRF token');

  const setCookies = (page.headers['set-cookie'] || []) as string[];
  const extraCookies: Record<string, string> = {};
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (k) extraCookies[k] = v;
    }
  }
  const cookieMap: Record<string, string> = {};
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookieMap[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  Object.assign(cookieMap, extraCookies);
  const mergedCookie = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const form = new FormData();
  form.append('_token', csrf);
  form.append('problemset_id', problemsetId);
  form.append('problem_id', problemId);
  form.append('language', String(language));
  form.append('code', code);

  const resp = await axios.post(`${BASE_URL}/solutions`, form, {
    headers: {
      'User-Agent': ua,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: pageUrl,
      Origin: BASE_URL,
      Cookie: mergedCookie,
    },
    timeout: 30000,
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  const data = resp.data;

  if (resp.status >= 400) {
    const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);

    // too_frequent：抛给上层重试
    if (bodyStr.includes('too_frequent') || bodyStr.includes('过于频繁')) {
      throw new Error('too_frequent');
    }

    if (resp.status === 422) {
      let detail = '';
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsed && parsed.errors) {
          detail = Object.entries(parsed.errors)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('; ');
        } else if (parsed && parsed.message) {
          detail = parsed.message;
        }
      } catch {
        detail = bodyStr.slice(0, 300);
      }
      throw new Error(
        `提交被服务器拒绝（HTTP 422）\n字段错误：${detail || '（无）'}\n完整响应：\n${bodyStr}`
      );
    }

    if (bodyStr.includes('EO_Bot_Ssid') || bodyStr.includes('_0x')) {
      throw new Error(
        `提交被 WZOI 的 Bot 防护拦截（HTTP ${resp.status}）。请稍等 30 秒后重试。`
      );
    }

    throw new Error(`提交失败（HTTP ${resp.status}）\n完整响应：\n${bodyStr}`);
  }

  if (data && typeof data === 'object' && typeof data.id === 'number') {
    return { solutionId: data.id };
  }

  const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);
  throw new Error(
    `提交成功但响应格式异常（HTTP ${resp.status}），响应：${bodyStr.slice(0, 200)}`
  );
}

/**
 * 根据文件扩展名猜语言
 */
export function guessLanguage(filename: string): LanguageOption | undefined {
    const lower = filename.toLowerCase();
    return LANGUAGE_OPTIONS.find((opt) =>
        opt.ext.some((e) => lower.endsWith(e))
    );
}