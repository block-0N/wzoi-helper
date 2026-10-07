import * as vscode from 'vscode';
import { DashboardData } from '../api/wzoi';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  public static readonly viewType = 'wzoiDashboard';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openProblem' && msg.problemsetId && msg.problemId) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            msg.problemsetId,
            msg.problemId
          );
        } else if (msg?.type === 'openProblemset' && msg.problemsetId) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblemset',
            msg.problemsetId
          );
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(data: DashboardData): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      DashboardPanel.currentPanel.panel.webview.html = render(data);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'WZOI 首页',
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = render(data);
    DashboardPanel.currentPanel = new DashboardPanel(panel);
  }
}

function render(d: DashboardData): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---- 作业 ----
  const homeworksHtml = d.homeworks.length
    ? d.homeworks
      .map((h) => {
        const pct = h.total ? Math.round((h.current / h.total) * 100) : 0;
        const done = h.current >= h.total && h.total > 0;
        return `<div class="homework">
            <div class="hw-head">
              <span class="hw-title">${esc(h.title)}</span>
              <span class="hw-count ${done ? 'done' : ''}">${h.current} / ${h.total}</span>
            </div>
            <div class="progress"><div class="bar ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
          </div>`;
      })
      .join('')
    : '<div class="empty">暂无作业</div>';

  // ---- 浏览历史 ----
  const historyHtml = d.history.length
    ? d.history
      .map((h) => {
        const m = h.url.match(/^\/s\/(\d+)\/(\d+)/);
        const link = m
          ? `<a href="#" class="problem-link" data-ps="${m[1]}" data-pid="${m[2]}">${esc(h.title)}</a>`
          : esc(h.title);
        const ps = h.problemsetUrl.match(/^\/s\/(\d+)/);
        const psLink = ps
          ? `<a href="#" class="problemset-link" data-ps="${ps[1]}">${esc(h.problemsetTitle)}</a>`
          : esc(h.problemsetTitle);
        return `<div class="history-item">
            <span class="check">${h.ac ? '✅' : '⬜'}</span>
            <div class="history-main">
              <div>${link}</div>
              <div class="history-sub">来自 ${psLink}</div>
            </div>
          </div>`;
      })
      .join('')
    : '<div class="empty">暂无记录</div>';

  // ---- 比赛 ----
  const contestsHtml = d.contests.length
    ? d.contests
      .map((c) => {
        const m = c.url.match(/^\/s\/(\d+)/);
        const link = m
          ? `<a href="#" class="problemset-link" data-ps="${m[1]}">${esc(c.title)}</a>`
          : esc(c.title);
        return `<div class="contest">
            <div class="contest-title">${link}</div>
            <div class="contest-time">
              <span class="time-start">${esc(c.startTime)}</span>
              <span class="time-sep">→</span>
              <span class="time-end">${esc(c.endTime)}</span>
            </div>
          </div>`;
      })
      .join('')
    : '<div class="empty">暂无比赛</div>';

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
    font-size: 15px;
    line-height: 1.7;
    padding: 28px 40px;
    max-width: 1080px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .subtitle { color: var(--muted); margin-bottom: 28px; font-size: 14px; }

  section { margin-bottom: 32px; }
  section > h2 {
    font-size: 18px;
    margin: 0 0 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 8px;
    background: rgba(127,127,127,0.12);
    font-size: 15px;
  }

  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 22px;
  }

  /* --- 作业 --- */
  .homework { padding: 12px 0; border-bottom: 1px solid var(--border); }
  .homework:first-child { padding-top: 0; }
  .homework:last-child { border-bottom: none; padding-bottom: 0; }
  .hw-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .hw-title { font-weight: 500; }
  .hw-count { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .hw-count.done { color: #4caf50; font-weight: 600; }
  .progress {
    height: 12px; background: rgba(127,127,127,0.15);
    border-radius: 6px; overflow: hidden;
  }
  .progress .bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #4caf50);
    border-radius: 6px;
    transition: width .3s ease;
  }
  .progress .bar.done {
    background: linear-gradient(90deg, #4caf50, #66bb6a);
  }

  /* --- 历史 --- */
  .history-item {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px 0; border-bottom: 1px solid var(--border);
  }
  .history-item:first-child { padding-top: 0; }
  .history-item:last-child { border-bottom: none; padding-bottom: 0; }
  .check { font-size: 18px; line-height: 1; margin-top: 3px; }
  .history-main { flex: 1; min-width: 0; }
  .history-sub { color: var(--muted); font-size: 13px; margin-top: 2px; }

  /* --- 比赛 --- */
  .contest {
    padding: 12px 0; border-bottom: 1px solid var(--border);
  }
  .contest:first-child { padding-top: 0; }
  .contest:last-child { border-bottom: none; padding-bottom: 0; }
  .contest-title { font-weight: 500; margin-bottom: 4px; }
  .contest-time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .time-sep { margin: 0 8px; }
  .time-start { color: #4caf50; }
  .time-end { color: #f44336; }

  .empty { color: var(--muted); font-style: italic; padding: 8px 0; }

  a {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>WZOI 首页</h1>
  <div class="subtitle">温中 OI 在线评测系统</div>

  <section>
    <h2><span class="icon">📝</span>作业进度</h2>
    <div class="card">${homeworksHtml}</div>
  </section>

  <section>
    <h2><span class="icon">🕒</span>浏览历史</h2>
    <div class="card">${historyHtml}</div>
  </section>

  <section>
    <h2><span class="icon">🏆</span>近期比赛</h2>
    <div class="card">${contestsHtml}</div>
  </section>

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
      document.querySelectorAll('.problemset-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openProblemset',
            problemsetId: el.getAttribute('data-ps'),
          });
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