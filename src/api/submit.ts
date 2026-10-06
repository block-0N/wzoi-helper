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
    const headers = {
        Cookie: cookie,
        'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
    };

    // 1. GET 题目页面，拿 CSRF token
    const pageUrl = `${BASE_URL}/s/${problemsetId}/${problemId}`;
    const page = await axios.get(pageUrl, { headers, timeout: 15000 });
    const $ = cheerio.load(page.data as string);
    const csrf =
        $('meta[name="csrf-token"]').attr('content') ||
        ($('input[name="_token"]').first().val() as string | undefined);
    if (!csrf) throw new Error('题目页找不到 CSRF token');

    // 2. 构造 multipart 表单
    const form = new FormData();
    form.append('_token', csrf);
    form.append('problemset_id', problemsetId);
    form.append('problem_id', problemId);
    form.append('language', String(language));
    form.append('code', code);

    // 3. POST
    const resp = await axios.post(`${BASE_URL}/solutions`, form, {
        headers,
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
    });

    const id = resp.data?.id;
    if (typeof id !== 'number') {
        throw new Error(`提交失败，服务器返回：${JSON.stringify(resp.data).slice(0, 200)}`);
    }
    return { solutionId: id };
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