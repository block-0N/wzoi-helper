import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://wzoi.cn';

export interface Problem {
    id: string;
    title: string;
    description: string;
    inputFormat: string;
    outputFormat: string;
    samples: { input: string; output: string }[];
    hint: string;
    timeLimit: string;
    memoryLimit: string;
    source: string;
}

export async function fetchProblem(
    id: string,
    problemsetId: string = '1',
    cookie?: string
): Promise<Problem> {
    const url = `${BASE_URL}/s/${problemsetId}/${id}`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    return parseProblem(id, html);
}

function parseProblem(id: string, html: string): Problem {
    const $ = cheerio.load(html);

    // 题目主容器
    const container = $('div[style*="font-size: 20px"]').first();
    const title = container.find('h1.page-header').text().trim();

    // 按 h4 标题分段，收集它后面直到下一个 h4 之前的所有文本
    const getSection = (headingKey: string): string => {
        const h4 = container
            .find('h4')
            .filter((_, el) => $(el).text().includes(headingKey))
            .first();
        if (!h4.length) return '';

        const parts: string[] = [];
        let next = h4.next();
        while (next.length && !next.is('h4')) {
            const text = next.text().trim();
            if (text) parts.push(text);
            next = next.next();
        }
        return parts.join('\n').trim();
    };

    const description = getSection('题目描述');
    const inputFormat = getSection('输入格式');
    const outputFormat = getSection('输出格式');
    const hint = getSection('提示');

    // 样例：.sample_io 按顺序成对出现（输入、输出、输入、输出……）
    const sampleTexts: string[] = [];
    container.find('pre.sample_io').each((_, el) => {
        sampleTexts.push($(el).text().trim());
    });
    const samples: { input: string; output: string }[] = [];
    for (let i = 0; i + 1 < sampleTexts.length; i += 2) {
        samples.push({ input: sampleTexts[i], output: sampleTexts[i + 1] });
    }

    // 时间/空间限制从整段文本里正则提取
    const fullText = container.text();
    const timeLimit = fullText.match(/时间限制:\s*(\d+\s*ms)/)?.[1] ?? '';
    const memoryLimit = fullText.match(/空间限制:\s*(\d+\s*MB)/)?.[1] ?? '';

    // 来源
    let source = '';
    container.find('p').each((_, el) => {
        const t = $(el).text().trim();
        if (t.startsWith('来源:')) {
            source = t.replace('来源:', '').trim();
        }
    });

    return {
        id,
        title,
        description,
        inputFormat,
        outputFormat,
        samples,
        hint,
        timeLimit,
        memoryLimit,
        source,
    };
}

/**
 * 把 Problem 拼成 Markdown 文本，方便在编辑器里展示
 */
export function problemToMarkdown(p: Problem): string {
    const lines: string[] = [];
    lines.push(`# ${p.title}`);
    lines.push('');
    if (p.timeLimit || p.memoryLimit) {
        lines.push(`> 时间限制: ${p.timeLimit}  空间限制: ${p.memoryLimit}`);
        lines.push('');
    }
    lines.push('## 题目描述');
    lines.push(p.description || '（无）');
    lines.push('');
    lines.push('## 输入格式');
    lines.push(p.inputFormat || '（无）');
    lines.push('');
    lines.push('## 输出格式');
    lines.push(p.outputFormat || '（无）');
    lines.push('');
    p.samples.forEach((s, i) => {
        lines.push(`## 样例 ${i + 1}`);
        lines.push('**输入**');
        lines.push('```');
        lines.push(s.input);
        lines.push('```');
        lines.push('**输出**');
        lines.push('```');
        lines.push(s.output);
        lines.push('```');
        lines.push('');
    });
    if (p.hint) {
        lines.push('## 提示');
        lines.push(p.hint);
        lines.push('');
    }
    if (p.source) {
        lines.push(`---`);
        lines.push(`来源: ${p.source}`);
    }
    return lines.join('\n');
}
export interface ProblemSummary {
    problemsetId: string;
    problemId: string;
    title: string;
}

export interface ProblemsetMeta {
    id: string;
    title: string;
    description: string;
    isContest: boolean;
    problems: ProblemSummary[];
}

/**
 * 抓取题库某一页
 */
export async function fetchProblemsetPage(
    problemsetId: string,
    page: number,
    cookie?: string
): Promise<{ meta: ProblemsetMeta; totalPages: number }> {
    const url = `${BASE_URL}/s/${problemsetId}?page=${page}`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });

    const meta = parseProblemset(problemsetId, html);
    const totalPages = parseTotalPages(html);
    return { meta, totalPages };
}

/**
 * 从分页组件里解析出总页数
 */
function parseTotalPages(html: string): number {
    const $ = cheerio.load(html);
    let max = 1;
    $('.pagination .page-link').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const m = href.match(/[?&]page=(\d+)/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
        }
    });
    return max;
}

/**
 * 抓取题库所有页，合并成完整列表。
 * onProgress 可以拿到 (currentPage, totalPages) 回调。
 */
export async function fetchProblemsetAll(
    problemsetId: string,
    cookie?: string,
    onProgress?: (current: number, total: number) => void
): Promise<ProblemsetMeta> {
    const first = await fetchProblemsetPage(problemsetId, 1, cookie);
    const total = first.totalPages;
    const all = [...first.meta.problems];
    onProgress?.(1, total);

    for (let p = 2; p <= total; p++) {
        // 稍微限速，别给 OJ 服务器压力
        await new Promise((r) => setTimeout(r, 200));
        try {
            const { meta } = await fetchProblemsetPage(problemsetId, p, cookie);
            all.push(...meta.problems);
        } catch (err) {
            console.error(`抓取 ${problemsetId} 第 ${p} 页失败:`, err);
        }
        onProgress?.(p, total);
    }

    return { ...first.meta, problems: all };
}

function parseProblemset(problemsetId: string, html: string): ProblemsetMeta {
    const $ = cheerio.load(html);

    const title = $('h1.page-header').first().text().trim();

    // 面包屑里如果有指向 /contests 的链接，就是比赛页面
    const isContest = $('ol.breadcrumb a[href="/contests"]').length > 0;

    // 描述：h1 后到表格前的所有 <p>
    const descParts: string[] = [];
    const $h1 = $('h1.page-header').first();
    let cursor = $h1.next();
    while (cursor.length && !cursor.is('div.table-responsive')) {
        if (cursor.is('p')) {
            const t = cursor.text().trim();
            if (t) descParts.push(t);
        }
        cursor = cursor.next();
    }

    // 题目：表格里每个 tr 的 td.text-left 里的 a
    const problems: ProblemSummary[] = [];
    const seen = new Set<string>();
    $('table.table tbody tr').each((_, tr) => {
        const a = $(tr).find('td.text-left a').first();
        if (!a.length) return;
        const href = a.attr('href') ?? '';
        const m = href.match(/^\/s\/(\d+)\/(\d+)/);
        if (!m) return;
        const key = `${m[1]}/${m[2]}`;
        if (seen.has(key)) return;
        seen.add(key);
        problems.push({
            problemsetId: m[1],
            problemId: m[2],
            title: a.text().trim(),
        });
    });

    return {
        id: problemsetId,
        title,
        description: descParts.join('\n').trim(),
        isContest,
        problems,
    };
}