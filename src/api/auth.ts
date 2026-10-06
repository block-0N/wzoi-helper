import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://wzoi.cn';

type CookieMap = Record<string, string>;

/** 从 Set-Cookie 响应头解析出 key=value 对 */
function parseSetCookie(headers: string[] | undefined): CookieMap {
    const result: CookieMap = {};
    if (!headers) return result;
    for (const line of headers) {
        const pair = line.split(';')[0];
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function cookiesToString(cookies: CookieMap): string {
    return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

/**
 * 用用户名密码登录 WZOI，返回可直接放进请求头的 Cookie 字符串。
 */
export async function loginWithPassword(
    username: string,
    password: string
): Promise<string> {
    const client = axios.create({
        timeout: 15000,
        headers: { 'User-Agent': 'VSCode-WZOI-Extension/0.0.1' },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
    });

    // ---- 1. GET 登录页：拿 CSRF token 和初始 Cookie ----
    const loginPage = await client.get(`${BASE_URL}/auth/login`);
    const $ = cheerio.load(loginPage.data as string);
    const csrfToken = $('input[name="_token"]').val() as string | undefined;
    if (!csrfToken) throw new Error('登录页找不到 CSRF token');

    let cookies: CookieMap = parseSetCookie(
        loginPage.headers['set-cookie'] as string[] | undefined
    );

    // ---- 2. POST 登录 ----
    const body = new URLSearchParams();
    body.append('_token', csrfToken);
    body.append('name', username);   // 如果 WZOI 用的是 username，改这一行
    body.append('password', password);

    const resp = await client.post(`${BASE_URL}/auth/login`, body.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${BASE_URL}/auth/login`,
            Cookie: cookiesToString(cookies),
        },
    });

    // 合并登录响应设置的 Cookie（通常包含 laravel_session）
    const more = parseSetCookie(resp.headers['set-cookie'] as string[] | undefined);
    cookies = { ...cookies, ...more };

    // ---- 3. 判断是否成功 ----
    const location = (resp.headers['location'] as string) ?? '';
    if (location.includes('/auth/login')) {
        throw new Error('用户名或密码错误');
    }

    const cookieStr = cookiesToString(cookies);
    if (!cookieStr.includes('laravel_session')) {
        throw new Error('登录后没有拿到 session Cookie，请检查表单字段名');
    }

    return cookieStr;
}