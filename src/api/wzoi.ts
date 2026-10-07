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

// ============ 提交相关 ============

export interface SubmissionSummary {
    id: number;
    userDisplay: string;
    problemTitle: string;
    score: string;
    time: string;
    memory: string;
    language: string;
    length: string;
    submitTime: string;
}

export interface SolutionDetail {
    id: number;
    userDisplay: string;
    problemTitle: string;
    problemUrl: string;
    score: string;
    time: string;
    memory: string;
    language: string;
    length: string;
    status: string;
    submitTime: string;
    judgeTime: string;
    testcases: {
        id: string;
        score: string;
        time: string;
        memory: string;
        verdict: string;
    }[];
    code: string;
    codeLanguage: string;
    isFinished: boolean;
}

/** 抓自己的提交列表 */
export async function fetchMySubmissions(
    username: string,
    cookie?: string
): Promise<SubmissionSummary[]> {
    const url = `${BASE_URL}/solutions?user_name=${encodeURIComponent(username)}`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    return parseSubmissionList(html);
}

function parseSubmissionList(html: string): SubmissionSummary[] {
    const $ = cheerio.load(html);
    const list: SubmissionSummary[] = [];
    $('#solutions-tbody > tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 9) return;
        const idText = tds.eq(0).text().trim();
        const id = parseInt(idText, 10);
        if (!id) return;
        list.push({
            id,
            userDisplay: tds.eq(1).find('a').first().text().trim() || tds.eq(1).text().trim(),
            problemTitle: tds.eq(2).text().trim(),
            score: tds.eq(3).text().trim(),
            time: tds.eq(4).text().trim(),
            memory: tds.eq(5).text().trim(),
            language: tds.eq(6).text().trim(),
            length: tds.eq(7).text().trim(),
            submitTime: tds.eq(8).text().trim(),
        });
    });
    return list;
}

/** 抓某个提交详情 */
export async function fetchSolution(
    id: number,
    cookie?: string
): Promise<SolutionDetail> {
    const url = `${BASE_URL}/solutions/${id}`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    return parseSolutionDetail(id, html);
}

function parseSolutionDetail(id: number, html: string): SolutionDetail {
    const $ = cheerio.load(html);

    const info: Record<string, string> = {};
    // 第一张表：th/td 成对
    $('table.table').first().find('tr').each((_, tr) => {
        const ths = $(tr).find('th');
        const tds = $(tr).find('td');
        ths.each((i, th) => {
            const key = $(th).text().trim();
            const val = tds.eq(i).text().trim();
            if (key && val) info[key] = val;
        });
    });

    const problemAnchor = $('table.table').first().find('a[href^="/s/"]').first();
    const problemUrl = problemAnchor.attr('href') ?? '';
    const problemTitle = problemAnchor.text().trim() || info['题目'] || '';

    const testcases: SolutionDetail['testcases'] = [];
    // 第二张表：测试点
    $('table.table').eq(1).find('tbody tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 5) return;
        testcases.push({
            id: tds.eq(0).text().trim(),
            score: tds.eq(1).text().trim(),
            time: tds.eq(2).text().trim(),
            memory: tds.eq(3).text().trim(),
            verdict: tds.eq(4).text().trim(),
        });
    });

    const codeEl = $('pre.line-numbers code').first();
    const code = codeEl.text();
    const codeClass = codeEl.attr('class') ?? '';
    const codeLanguage = codeClass.replace('language-', '').trim();

    const status = info['状态'] ?? '';
    const isFinished = status.includes('评测完成') || status.includes('编译错误');

    return {
        id,
        userDisplay: info['用户'] ?? '',
        problemTitle,
        problemUrl,
        score: info['分数'] ?? '',
        time: info['耗时'] ?? '',
        memory: info['内存'] ?? '',
        language: info['语言'] ?? '',
        length: info['长度'] ?? '',
        status,
        submitTime: info['提交时间'] ?? '',
        judgeTime: info['评测时间'] ?? '',
        testcases,
        code,
        codeLanguage,
        isFinished,
    };
}

// ============ 比赛相关 ============

export interface ContestSummary {
    id: string;
    title: string;
    type: string;
    startTime: string;
    endTime: string;
    tag: string;
    isRunning: boolean;
}

export async function fetchContests(
    cookie?: string
): Promise<ContestSummary[]> {
    const url = `${BASE_URL}/contests`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    return parseContests(html);
}

function parseContests(html: string): ContestSummary[] {
    const $ = cheerio.load(html);
    const list: ContestSummary[] = [];
    $('#contests-table tbody tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 6) return;
        const id = tds.eq(0).text().trim();
        const title = tds.eq(1).find('a').first().text().trim();
        const type = tds.eq(2).text().trim();
        const startTime = tds.eq(3).text().trim();
        const endTime = tds.eq(4).text().trim();
        const tag = tds.eq(5).text().trim();
        // 根据开始/结束时间判断是否进行中（本地时间粗略判断）
        const now = Date.now();
        const start = Date.parse(startTime.replace(/-/g, '/'));
        const end = Date.parse(endTime.replace(/-/g, '/'));
        const isRunning = !isNaN(start) && !isNaN(end) && now >= start && now <= end;
        list.push({ id, title, type, startTime, endTime, tag, isRunning });
    });
    return list;
}

// ============ 用户信息 ============

/** 从已登录的首页解析当前用户名 */
export async function fetchCurrentUsername(
    cookie: string
): Promise<string | undefined> {
    const { data: html } = await axios.get(`${BASE_URL}/`, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            Cookie: cookie,
        },
        timeout: 15000,
    });
    const $ = cheerio.load(html);
    // 找 <a class="dropdown-item" href="/users/xxx"> 用户名 </a>
    let username: string | undefined;
    $('a.dropdown-item[href^="/users/"]').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !username) username = text;
    });
    return username;
}

/** 翻页抓取自己所有提交记录 */
export async function fetchAllMySubmissions(
    username: string,
    cookie?: string,
    onProgress?: (page: number, count: number) => void
): Promise<SubmissionSummary[]> {
    const all: SubmissionSummary[] = [];
    let url: string | undefined =
        `${BASE_URL}/solutions?user_name=${encodeURIComponent(username)}`;
    let page = 0;
    while (url && page < 50) {
        page++;
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
                ...(cookie ? { Cookie: cookie } : {}),
            },
            timeout: 15000,
        });
        all.push(...parseSubmissionList(html));
        onProgress?.(page, all.length);

        const $ = cheerio.load(html);
        const next = $('a[rel="next"]').attr('href');
        if (!next) break;
        url = next.startsWith('http') ? next : `${BASE_URL}${next}`;
        await new Promise((r) => setTimeout(r, 200));
    }
    return all;
}

/** 从提交列表构建「题目名 → 最高分」映射 */
export function buildScoreIndex(
    subs: SubmissionSummary[]
): Map<string, number> {
    const map = new Map<string, number>();
    for (const s of subs) {
        const score = parseFloat(s.score);
        if (isNaN(score)) continue;
        const prev = map.get(s.problemTitle) ?? -1;
        if (score > prev) map.set(s.problemTitle, score);
    }
    return map;
}
export interface DashboardData {
    homeworks: { title: string; url: string; current: number; total: number }[];
    history: {
        title: string;
        url: string;
        problemsetTitle: string;
        problemsetUrl: string;
        ac: boolean;
    }[];
    contests: { title: string; url: string; startTime: string; endTime: string }[];
}

export async function fetchDashboard(cookie?: string): Promise<DashboardData> {
    const { data: html } = await axios.get(`${BASE_URL}/`, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    const $ = cheerio.load(html);

    const homeworks: DashboardData['homeworks'] = [];
    const history: DashboardData['history'] = [];
    const contests: DashboardData['contests'] = [];

    $('.card').each((_, card) => {
        const header = $(card).find('.card-header').first().text().trim();

        if (header === '作业') {
            $(card).find('.list-group-item').each((_, li) => {
                const a = $(li).find('a').first();
                const title = a.text().trim();
                const url = a.attr('href') ?? '';
                const txt = $(li).find('.progress-bar').text().trim();
                const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
                if (title) {
                    homeworks.push({
                        title,
                        url,
                        current: m ? parseInt(m[1], 10) : 0,
                        total: m ? parseInt(m[2], 10) : 0,
                    });
                }
            });
        }

        if (header === '浏览历史') {
            $(card).find('.list-group-item').each((_, li) => {
                const mainA = $(li).find('.col-10 a').first();
                const psA = $(li).find('.col-10 small a').first();
                const title = mainA.text().trim();
                const url = mainA.attr('href') ?? '';
                if (title) {
                    history.push({
                        title,
                        url,
                        problemsetTitle: psA.text().trim(),
                        problemsetUrl: psA.attr('href') ?? '',
                        ac: $(li).find('span.fa-check').length > 0,
                    });
                }
            });
        }

        if (header === '近期比赛') {
            $(card).find('.list-group-item').each((_, li) => {
                const a = $(li).find('a').first();
                const title = a.text().trim();
                const url = a.attr('href') ?? '';
                const spans = $(li).find('span');
                if (title) {
                    contests.push({
                        title,
                        url,
                        startTime: spans.eq(0).text().trim(),
                        endTime: spans.eq(1).text().trim(),
                    });
                }
            });
        }
    });

    return { homeworks, history, contests };
}
export interface TagInfo {
    id: string;
    name: string;
}

export async function fetchTags(): Promise<TagInfo[]> {
    const { data: html } = await axios.get(`${BASE_URL}/`, {
        headers: { 'User-Agent': 'VSCode-WZOI-Extension/0.0.1' },
        timeout: 15000,
    });
    const $ = cheerio.load(html);
    const tags: TagInfo[] = [];
    $('#tags-select option').each((_, el) => {
        const id = $(el).attr('value') ?? '';
        const name = $(el).text().trim();
        if (id && name) tags.push({ id, name });
    });
    return tags;
}

export async function searchByTag(
    tagId: string,
    cookie?: string
): Promise<ProblemSummary[]> {
    const url = `${BASE_URL}/search?tags%5B%5D=${tagId}&search_item=problems`;
    const { data: html } = await axios.get(url, {
        headers: {
            'User-Agent': 'VSCode-WZOI-Extension/0.0.1',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
    });
    const $ = cheerio.load(html);
    const list: ProblemSummary[] = [];
    const seen = new Set<string>();
    $('td.text-left a[href^="/s/"]').each((_, a) => {
        const href = $(a).attr('href') ?? '';
        const m = href.match(/^\/s\/(\d+)\/(\d+)/);
        if (!m) return;
        const key = `${m[1]}/${m[2]}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({
            problemsetId: m[1],
            problemId: m[2],
            title: $(a).text().trim(),
        });
    });
    return list;
}