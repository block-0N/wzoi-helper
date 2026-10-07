import * as vscode from 'vscode';
import { Problem } from '../api/wzoi';

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
    output: vscode.OutputChannel
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (ProblemPanel.currentPanel) {
      ProblemPanel.currentPanel.panel.reveal(column);
      ProblemPanel.currentPanel.panel.title = problem.title || `题目 ${problem.id}`;
      ProblemPanel.currentPanel.panel.webview.html = render(
        problem,
        ProblemPanel.currentPanel.panel.webview,
        ProblemPanel.currentPanel.extensionUri
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

    panel.webview.html = render(problem, panel.webview, extensionUri);
    ProblemPanel.currentPanel = new ProblemPanel(panel, extensionUri, output);
  }
}

/** 把 \( \) \[ \] 统一成 $ $ $$ $$，避免反斜杠残留问题 */
function normalizeMathDelims(s: string): string {
  return s
    .replace(/\\\[/g, '$$$$')
    .replace(/\\\]/g, '$$$$')
    .replace(/\\\(/g, '$$')
    .replace(/\\\)/g, '$$');
}

function render(
  p: Problem,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const mathjaxUri = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'mathjax', 'tex-svg.js')
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
</style>
</head>
<body>
  <h1>${esc(p.title)}</h1>
  <div class="meta-row">
    <span class="meta-chip">题目 ID<strong>${esc(p.id)}</strong></span>
    <span class="meta-chip">时间限制<strong>${esc(p.timeLimit || '—')}</strong></span>
    <span class="meta-chip">空间限制<strong>${esc(p.memoryLimit || '—')}</strong></span>
  </div>
  <section>
    <h2>题目描述</h2>
    <div class="content">${esc(normalizeMathDelims(p.description || '（无）'))}</div>
  </section>
  <section>
    <h2>输入格式</h2>
    <div class="content">${esc(normalizeMathDelims(p.inputFormat || '（无）'))}</div>
  </section>
  <section>
    <h2>输出格式</h2>
    <div class="content">${esc(normalizeMathDelims(p.outputFormat || '（无）'))}</div>
  </section>
  ${samplesHtml ? `<section><h2>样例</h2>${samplesHtml}</section>` : ''}
  ${p.hint ? `<section><h2>提示</h2><div class="content">${esc(normalizeMathDelims(p.hint))}</div></section>` : ''}
  ${p.source ? `<hr><div class="source">来源: ${esc(p.source)}</div>` : ''}

  <script nonce="${nonce}">
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        processEscapes: true,
      },
      svg: { fontCache: 'global' },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      },
    };
  </script>
  <script nonce="${nonce}" src="${mathjaxUri}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const text = decodeURIComponent(btn.getAttribute('data-copy'));
          vscode.postMessage({ type: 'copy', text });
        });
      });
    })();
  </script>
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