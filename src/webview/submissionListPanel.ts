import * as vscode from 'vscode';
import { SubmissionListItem } from '../api/wzoi';

export class SubmissionListPanel {
  public static currentPanel: SubmissionListPanel | undefined;
  public static readonly viewType = 'wzoiSubmissionList';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openSolution' && msg.id) {
          vscode.commands.executeCommand('wzoi-helper.openSolution', msg.id);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    SubmissionListPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(
    title: string,
    items: SubmissionListItem[]
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (SubmissionListPanel.currentPanel) {
      SubmissionListPanel.currentPanel.panel.reveal(column);
      SubmissionListPanel.currentPanel.panel.title = title;
      SubmissionListPanel.currentPanel.panel.webview.html = render(title, items);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SubmissionListPanel.viewType,
      title,
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = render(title, items);
    SubmissionListPanel.currentPanel = new SubmissionListPanel(panel);
  }
}

function render(title: string, items: SubmissionListItem[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const rows = items
    .map(
      (it) => `<tr>
        <td><a href="#" class="solution-link" data-id="${it.id}">${it.id}</a></td>
        <td>${esc(it.problemTitle)}</td>
        <td>${esc(it.score)}</td>
        <td>${esc(it.time)}</td>
        <td>${esc(it.memory)}</td>
        <td>${esc(it.language)}</td>
        <td>${esc(it.length)}</td>
        <td>${esc(it.submitTime)}</td>
      </tr>`
    )
    .join('');

  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';">
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
    font-size: 14px;
    line-height: 1.6;
    padding: 24px 32px;
    max-width: 1200px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--card);
    border-radius: 8px;
    overflow: hidden;
  }
  th, td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-size: 13px;
    white-space: nowrap;
  }
  th { background: rgba(127,127,127,0.08); font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  a { color: var(--accent); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  .score-100 { color: #4caf50; font-weight: 600; }
  .score-0 { color: #f44336; }
  .score-partial { color: #ff9800; }
  .score-ce { color: #9e9e9e; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">共 ${items.length} 条记录</div>
  <table>
    <thead>
      <tr>
        <th>编号</th>
        <th>题目</th>
        <th>分数</th>
        <th>耗时</th>
        <th>内存</th>
        <th>语言</th>
        <th>长度</th>
        <th>提交时间</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('.solution-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const id = parseInt(el.getAttribute('data-id'), 10);
          if (id) vscode.postMessage({ type: 'openSolution', id });
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