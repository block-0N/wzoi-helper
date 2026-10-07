import * as vscode from 'vscode';
import { SolutionDetail } from '../api/wzoi';

export class SolutionPanel {
  public static currentPanel: SolutionPanel | undefined;
  public static readonly viewType = 'wzoiSolution';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openProblem' && msg.problemsetId && msg.problemId) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            msg.problemsetId,
            msg.problemId
          );
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    SolutionPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    detail: SolutionDetail
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (SolutionPanel.currentPanel) {
      SolutionPanel.currentPanel.panel.reveal(column);
      SolutionPanel.currentPanel.panel.title = `提交 #${detail.id}`;
      SolutionPanel.currentPanel.panel.webview.html = render(
        detail,
        SolutionPanel.currentPanel.panel.webview,
        SolutionPanel.currentPanel.extensionUri
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SolutionPanel.viewType,
      `提交 #${detail.id}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
      }
    );

    panel.webview.html = render(detail, panel.webview, extensionUri);
    SolutionPanel.currentPanel = new SolutionPanel(panel, extensionUri);
  }
}

function render(
  d: SolutionDetail,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const hljsJs = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'highlight.min.js'))
    .toString();
  const hljsCss = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'atom-one-dark.min.css')
    )
    .toString();

  const m = d.problemUrl.match(/^\/s\/(\d+)\/(\d+)/);
  const psId = m?.[1] ?? '';
  const pid = m?.[2] ?? '';

  const problemLink =
    psId && pid
      ? `<a href="#" class="problem-link" data-ps="${psId}" data-pid="${pid}">${esc(d.problemTitle)}</a>`
      : esc(d.problemTitle);

  const scoreNum = parseFloat(d.score);
  const overallClass = !d.isFinished
    ? 'pending'
    : scoreNum >= 100
      ? 'ac'
      : scoreNum > 0
        ? 'partial'
        : 'wa';

  const overallLabel = !d.isFinished
    ? d.status || '等待评测'
    : scoreNum >= 100
      ? 'AC'
      : scoreNum > 0
        ? `${scoreNum} 分`
        : '未通过';

  const tests = d.testcases
    .map((t) => {
      const v = t.verdict || '';
      const cls =
        v === 'AC' ? 'ac' : v === 'WA' ? 'wa' : v === 'TLE' || v === 'RE' ? 'tle' : '';
      return `<tr>
        <td>${esc(t.id)}</td>
        <td>${esc(t.score)}</td>
        <td>${esc(t.time)}</td>
        <td>${esc(t.memory)}</td>
        <td><span class="pill ${cls}">${esc(v)}</span></td>
      </tr>`;
    })
    .join('');

  const nonce = makeNonce();
  const langMap: Record<string, string> = {
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    py: 'python',
    python: 'python',
    pas: 'pascal',
  };
  const hlLang = langMap[d.codeLanguage] ?? 'plaintext';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline' ${webview.cspSource};
    script-src 'nonce-${nonce}' ${webview.cspSource};
    font-src ${webview.cspSource};
    img-src https: data: ${webview.cspSource};">
<link rel="stylesheet" href="${hljsCss}">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --bg: var(--vscode-editor-background);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --card: var(--vscode-editorWidget-background);
    --accent: var(--vscode-textLink-foreground);
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.75;
    padding: 28px 40px;
    max-width: 1080px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px;
  }
  .header h1 { font-size: 26px; margin: 0; }
  .badge {
    display: inline-block;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 15px;
    font-weight: 600;
  }
  .badge.ac { background: rgba(76, 175, 80, 0.18); color: #4caf50; }
  .badge.wa { background: rgba(244, 67, 54, 0.18); color: #f44336; }
  .badge.partial { background: rgba(255, 152, 0, 0.18); color: #ff9800; }
  .badge.pending { background: rgba(33, 150, 243, 0.18); color: #2196f3; }

  .meta-row {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .meta-row span + span::before { content: " · "; margin: 0 6px; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin: 20px 0 28px;
  }
  .stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
  }
  .stat .k { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .stat .v { font-size: 17px; font-weight: 600; word-break: break-all; }

  h2 {
    font-size: 18px;
    margin: 28px 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--card);
    border-radius: 8px;
    overflow: hidden;
  }
  th, td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-size: 14px;
  }
  th { background: rgba(127,127,127,0.08); font-weight: 600; }
  tr:last-child td { border-bottom: none; }

  .pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .pill.ac { background: rgba(76, 175, 80, 0.2); color: #4caf50; }
  .pill.wa { background: rgba(244, 67, 54, 0.2); color: #f44336; }
  .pill.tle { background: rgba(255, 152, 0, 0.2); color: #ff9800; }

  pre {
    margin: 0;
    padding: 18px 22px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 14px;
    line-height: 1.6;
    background: #282c34;
  }
  pre code {
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 14px;
    background: transparent !important;
  }
  .hljs { background: transparent !important; padding: 0 !important; }

  a.problem-link {
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  a.problem-link:hover { text-decoration: none; }
</style>
</head>
<body>
  <div class="header">
    <h1>提交 #${d.id}</h1>
    <span class="badge ${overallClass}">${overallLabel}</span>
  </div>
  <div class="meta-row">
    <span>${esc(d.userDisplay)}</span>
    <span>${esc(d.submitTime)}</span>
    <span>${esc(d.language)}</span>
    <span>${esc(d.length)}</span>
  </div>

  <div class="grid">
    <div class="stat"><div class="k">题目</div><div class="v">${problemLink}</div></div>
    <div class="stat"><div class="k">分数</div><div class="v">${esc(d.score)}</div></div>
    <div class="stat"><div class="k">耗时</div><div class="v">${esc(d.time)}</div></div>
    <div class="stat"><div class="k">内存</div><div class="v">${esc(d.memory)}</div></div>
  </div>

  ${tests ? `<h2>测试点</h2>
  <table>
    <thead><tr><th>测试点</th><th>分数</th><th>耗时</th><th>内存</th><th>结果</th></tr></thead>
    <tbody>${tests}</tbody>
  </table>` : ''}

  ${d.code ? `<h2>代码</h2>
  <pre><code class="language-${hlLang}">${esc(d.code)}</code></pre>` : ''}

  <script nonce="${nonce}" src="${hljsJs}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('.problem-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openProblem',
            problemsetId: el.getAttribute('data-ps'),
            problemId: el.getAttribute('data-pid'),
          });
        });
      });

      function tryHighlight() {
        if (typeof window.hljs === 'undefined') {
          setTimeout(tryHighlight, 50);
          return;
        }
        document.querySelectorAll('pre code').forEach((el) => {
          try { window.hljs.highlightElement(el); } catch (_) {}
        });
      }
      tryHighlight();
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