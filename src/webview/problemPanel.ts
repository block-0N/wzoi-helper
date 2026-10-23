import * as vscode from 'vscode';
import { Problem } from '../api/wzoi';
import type { ProblemRecord } from '../indexer/problemIndexer';

export class ProblemPanel {
  public static currentPanel: ProblemPanel | undefined;
  public static readonly viewType = 'wzoiProblem';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    output: vscode.OutputChannel
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.output = output;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openHistory' && msg.pid) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblemHistory',
            msg.ps ? String(msg.ps) : undefined,
            String(msg.pid)
          );
          return;
        }
        if (msg?.type === 'revealInTree' && msg.pid) {
vscode.commands.executeCommand(
            'wzoi-helper.revealInTree',
            String(msg.pid),
            msg.ps ? String(msg.ps) : undefined
          );
          return;
        }
        if (msg?.type === 'copy') {
          vscode.env.clipboard.writeText(String(msg.text ?? ''));
          vscode.window.setStatusBarMessage('已复制到剪贴板', 1500);
        } else if (msg?.type === 'mathjax-debug') {
          this.output.appendLine('===== Webview 诊断 =====');
          this.output.appendLine(JSON.stringify(msg.info, null, 2));
          this.output.appendLine('========================');
        } else if (msg?.type === 'mathjax-error') {
          this.output.appendLine('!! Webview 错误: ' + msg.message);
          if (msg.stack) this.output.appendLine(msg.stack);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    ProblemPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    problem: Problem,
    problemsetId: string,
    output: vscode.OutputChannel,
    record?: ProblemRecord
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (ProblemPanel.currentPanel) {
      ProblemPanel.currentPanel.panel.reveal(column);
      ProblemPanel.currentPanel.panel.title = problem.title || `题目 ${problem.id}`;
      ProblemPanel.currentPanel.panel.webview.html = render(
        problem,
        ProblemPanel.currentPanel.panel.webview,
        ProblemPanel.currentPanel.extensionUri,
        problemsetId,
        record
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ProblemPanel.viewType,
      problem.title || `题目 ${problem.id}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
      }
    );

    panel.webview.html = render(problem, panel.webview, extensionUri, problemsetId, record);
    ProblemPanel.currentPanel = new ProblemPanel(panel, extensionUri, output);
  }
}

/** 把 \( \) \[ \] 统一成 $ $ $$ $$，避免反斜杠残留问题 */
function normalizeMathDelims(s: string): string {
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => '$$' + inner + '$$');
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => '$' + inner + '$');
  return s;
}
/**
 * 渲染富文本内容：先保留 HTML 格式，再用 DOMPurify 过滤危险标签，
 * 最后把 \( \) \[ \] 归一化为 $ 和 $$。
 */
function renderRichText(html: string): string {
  // DOMPurify 在 Node 环境需要一个 window 对象，用 jsdom 或简化方案
  // 这里我们只做最小白名单过滤，避免引入 jsdom 依赖
  return normalizeMathDelims(sanitizeHtml(html));
}

/**
 * 极简白名单过滤：只保留题面中常见的格式标签，去掉 script/iframe/on* 等危险内容。
 * 比引入 jsdom + DOMPurify 更轻量。
 */
function sanitizeHtml(html: string): string {
  if (!html) return '';
  let s = html;

  // 1) 去掉危险标签（成对 + 单标签）
  s = s.replace(
    /<\s*(script|style|iframe|object|embed|form|input|button|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );
  s = s.replace(
    /<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|link|meta|base)\b[^>]*>/gi,
    ''
  );

  // 2) 去掉 on* 事件属性（onclick、onerror 等）
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');

  // 3) 去掉 javascript: 协议
  s = s.replace(/javascript\s*:/gi, '');

  return s;
}
function render(
  p: Problem,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problemsetId: string,
  record?: ProblemRecord
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const mathjaxUri = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'mathjax', 'tex-svg.js')
    )
    .toString();

  const hljsJs = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'highlight.min.js')
    )
    .toString();
  const hljsCss = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'atom-one-dark.min.css')
    )
    .toString();

  const samplesHtml = p.samples
    .map(
      (s, i) => `
      <div class="sample">
        <div class="sample-header">样例 ${i + 1}</div>
        <div class="sample-body">
          <div class="io-block">
            <div class="io-label">
              <span>输入</span>
              <button class="copy-btn" data-copy="${encodeURIComponent(s.input)}">复制</button>
            </div>
            <pre>${esc(s.input)}</pre>
          </div>
          <div class="io-block">
            <div class="io-label">
              <span>输出</span>
              <button class="copy-btn" data-copy="${encodeURIComponent(s.output)}">复制</button>
            </div>
            <pre>${esc(s.output)}</pre>
          </div>
        </div>
      </div>`
    )
    .join('');

  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline' ${webview.cspSource};
    script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval' blob:;
    font-src ${webview.cspSource};
    img-src https: data: ${webview.cspSource};">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --bg: var(--vscode-editor-background);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --card: var(--vscode-editorWidget-background);
    --accent: var(--vscode-textLink-foreground);
    --code-bg: var(--vscode-textCodeBlock-background);
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.8;
    padding: 28px 40px;
    max-width: 1080px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 26px; text-align: center; margin: 0 0 12px; line-height: 1.4; }
  .meta-row {
    display: flex; justify-content: center; gap: 12px;
    flex-wrap: wrap; margin-bottom: 28px;
  }
  .meta-chip {
    display: inline-flex; align-items: center;
    padding: 4px 12px; border-radius: 14px;
    background: var(--card); border: 1px solid var(--border);
    font-size: 13px; color: var(--muted);
  }
  .meta-chip strong { color: var(--fg); margin-left: 4px; font-weight: 600; }
  section { margin-bottom: 24px; }
  section > h2 {
    font-size: 17px; margin: 0 0 10px;
    display: flex; align-items: center; gap: 8px;
    color: var(--fg);
  }
  section > h2::before {
    content: ""; display: inline-block;
    width: 4px; height: 16px; border-radius: 2px;
    background: var(--accent);
  }
  .content {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 22px;
    white-space: pre-wrap; word-wrap: break-word;
  }
  .sample {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; margin-bottom: 16px; overflow: hidden;
  }
  .sample-header {
    padding: 8px 16px; background: rgba(127,127,127,0.08);
    font-size: 13px; font-weight: 600; color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .sample-body {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 1px; background: var(--border);
  }
  @media (max-width: 720px) { .sample-body { grid-template-columns: 1fr; } }
  .io-block { background: var(--bg); display: flex; flex-direction: column; }
  .io-label {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 12px; font-size: 12px; color: var(--muted);
  }
  .copy-btn {
    background: none; border: none; color: var(--accent);
    cursor: pointer; font-size: 12px; padding: 2px 8px; border-radius: 4px;
  }
  .copy-btn:hover { background: rgba(127,127,127,0.15); }
  .io-block pre {
    margin: 0; padding: 10px 14px;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 14px; line-height: 1.6;
    background: var(--code-bg); overflow-x: auto; flex: 1;
  }
  hr { border: none; border-top: 1px solid var(--border); margin: 28px 0 16px; }
  .source { text-align: center; color: var(--muted); font-size: 13px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  mjx-container { font-size: 1.05em; }

  .meta-chip-btn {
    cursor: pointer;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--accent);
    font-family: inherit;
    font-size: 13px;
    transition: background 0.15s, border-color 0.15s;
  }
  .meta-chip-btn:hover {
    background: rgba(127,127,127,0.15);
    border-color: var(--accent);
  }


  .extra-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: -12px auto 16px;
    max-width: 900px;
    padding: 8px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .extra-label {
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .extra-content {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    justify-content: center;
  }
  .ps-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    background: rgba(127,127,127,0.12);
    border-radius: 12px;
    font-size: 12px;
  }
  .ps-id {
    margin-left: 4px;
    color: var(--muted);
    font-size: 10px;
  }
  .tag-chip {
    display: inline-block;
    padding: 2px 10px;
    background: rgba(127,127,127,0.15);
    border-radius: 12px;
    font-size: 12px;
    color: var(--accent);
  }
  /* 富文本内容：还原 WZOI 题面的格式 */
  .content.rich { white-space: normal; }
  .content.rich p { margin: 8px 0; }
  .content.rich ul,
  .content.rich ol { padding-left: 24px; margin: 8px 0; }
  .content.rich li { margin: 2px 0; }
  .content.rich strong,
  .content.rich b { font-weight: 600; }
  .content.rich em,
  .content.rich i { font-style: italic; }
  .content.rich code {
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    background: var(--code-bg);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.92em;
  }
  .content.rich pre {
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    background: var(--code-bg);
    padding: 10px 14px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
    margin: 8px 0;
  }
  .content.rich pre code {
    padding: 0;
    background: transparent;
  }
  .content.rich pre code[class*="language-"] {
    display: block;
  }
  .content.rich a {
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .content.rich hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }
    /* 题解区块 */
  .content.rich.solution pre {
    background: #282c34;
    border-radius: 8px;
    padding: 16px 20px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.6;
  }
  .content.rich.solution pre code {
    background: transparent;
    color: #abb2bf;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  }
</style>
<link rel="stylesheet" href="${hljsCss}">
</head>
<body>
  <h1>${esc(p.title)}</h1>
  <div class="meta-row">
    <span class="meta-chip">题目 ID<strong>${esc(p.id)}</strong></span>
    <span class="meta-chip">时间限制<strong>${esc(p.timeLimit || '—')}</strong></span>
    <span class="meta-chip">空间限制<strong>${esc(p.memoryLimit || '—')}</strong></span>
    <button class="meta-chip meta-chip-btn" id="reveal-in-tree"
      data-pid="${esc(p.id)}"
      data-ps="${esc(problemsetId)}"
      title="在侧边栏中定位此题">
      ☰ 在侧边栏打开
    </button>
    <button class="meta-chip meta-chip-btn" id="open-history"
      data-pid="${esc(p.id)}"
      data-ps="${esc(problemsetId)}"
      title="查看我的历史提交">
      🕘 历史提交
    </button>
  </div>

  ${record && record.problemsets.length > 0 ? `<div class="extra-row">
    <span class="extra-label">所属题库:</span>
    <div class="extra-content">
      ${record.problemsets
        .map((ps) => `<span class="ps-chip">${esc(ps.title)}<span class="ps-id">#${esc(ps.id)}</span></span>`)
        .join('')}
    </div>
  </div>` : ''}

  ${record && record.tags.length > 0 ? `<div class="extra-row">
    <span class="extra-label">算法标签:</span>
    <div class="extra-content">
      ${record.tags
        .map((t) => `<span class="tag-chip">${esc(t.name)}</span>`)
        .join('')}
    </div>
  </div>` : ''}
  <section>
    <h2>题目描述</h2>
    <div class="content rich">${renderRichText(p.description || '（无）')}</div>
  </section>
  <section>
    <h2>输入格式</h2>
    <div class="content rich">${renderRichText(p.inputFormat || '（无）')}</div>
  </section>
  <section>
    <h2>输出格式</h2>
    <div class="content rich">${renderRichText(p.outputFormat || '（无）')}</div>
  </section>

  ${samplesHtml ? `<section><h2>样例</h2>${samplesHtml}</section>` : ''}

  ${p.hint ? `<section><h2>提示</h2><div class="content rich">${renderRichText(p.hint)}</div></section>` : ''}

  ${p.source ? `<hr><div class="source">来源: ${esc(p.source)}</div>` : ''}

  ${p.solution ? `<section>
    <h2>题解</h2>
    <div class="content rich solution">${renderRichText(p.solution)}</div>
  </section>` : ''}
  <script nonce="${nonce}">
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
        processEscapes: true,
      },
      svg: { fontCache: 'global' },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        ignoreHtmlClass: 'tex2jax_ignore',
        processHtmlClass: 'tex2jax_process',
      },
    };
  </script>
  <script nonce="${nonce}" src="${mathjaxUri}"></script>
  <script nonce="${nonce}">
    (function() {
      let vscode;
      try {
        vscode = acquireVsCodeApi();
        window.__vscodeApi = vscode;
      } catch (e) {
        vscode = window.__vscodeApi;
        if (!vscode) {
          return;
        }
      }

      // 在侧边栏打开按钮
      const historyBtn = document.getElementById('open-history');
      if (historyBtn) {
        historyBtn.addEventListener('click', () => {
          try {
            vscode.postMessage({
              type: 'openHistory',
              pid: historyBtn.getAttribute('data-pid'),
              ps: historyBtn.getAttribute('data-ps'),
            });
          } catch (e) {
            console.error('openHistory postMessage failed:', e);
          }
        });
      }

      const revealBtn = document.getElementById('reveal-in-tree');
      if (revealBtn) {
        revealBtn.addEventListener('click', () => {
  try {
            vscode.postMessage({
            type: 'revealInTree',
            pid: revealBtn.getAttribute('data-pid'),
            ps: revealBtn.getAttribute('data-ps'),
            });
          } catch (e) {
            console.error('postMessage failed:', e);
          }
        });
      }

      // 修正题目里相对路径的图片（WZOI 常用 ../../files/... 形式）
      document.querySelectorAll('.content img').forEach((img) => {
        const s = img.getAttribute('src');
        if (!s) return;
        if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//') || s.startsWith('data:')) return;
        let p = s;
        while (p.startsWith('../')) {
          p = p.slice(3);
        }
        if (p.startsWith('/')) {
          p = p.slice(1);
        }
        img.src = 'https://wzoi.cn/' + p;
      })
      document.querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const text = decodeURIComponent(btn.getAttribute('data-copy'));
          vscode.postMessage({ type: 'copy', text });
        });
      });

      function tryHighlight() {
        if (typeof window.hljs === 'undefined') {
          setTimeout(tryHighlight, 50);
          return;
        }
        document.querySelectorAll('.content.rich pre code').forEach((el) => {
          try { window.hljs.highlightElement(el); } catch (_) {}
        });
      }
      tryHighlight();
    })();
  </script>
  <script nonce="${nonce}" src="${hljsJs}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}