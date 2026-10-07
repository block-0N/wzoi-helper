import * as vscode from 'vscode';
import { SolutionDetail } from '../api/wzoi';

export class SolutionPanel {
    public static currentPanel: SolutionPanel | undefined;
    public static readonly viewType = 'wzoiSolution';

    private readonly panel: vscode.WebviewPanel;

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.panel.onDidDispose(() => {
            SolutionPanel.currentPanel = undefined;
        });
    }

    public static createOrShow(detail: SolutionDetail): void {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (SolutionPanel.currentPanel) {
            SolutionPanel.currentPanel.panel.reveal(column);
            SolutionPanel.currentPanel.panel.title = `提交 #${detail.id}`;
            SolutionPanel.currentPanel.panel.webview.html = render(detail);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            SolutionPanel.viewType,
            `提交 #${detail.id}`,
            column ?? vscode.ViewColumn.One,
            { enableScripts: false, retainContextWhenHidden: true }
        );

        panel.webview.html = render(detail);
        SolutionPanel.currentPanel = new SolutionPanel(panel);
    }
}

function render(d: SolutionDetail): string {
    const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const verdictClass = (v: string) => {
        if (v === 'AC') return 'ac';
        if (v === 'WA') return 'wa';
        if (v === 'TLE' || v === 'RE') return 'tle';
        return '';
    };

    const tests = d.testcases
        .map(
            (t) => `<tr>
        <td>${esc(t.id)}</td>
        <td>${esc(t.score)}</td>
        <td>${esc(t.time)}</td>
        <td>${esc(t.memory)}</td>
        <td class="${verdictClass(t.verdict)}">${esc(t.verdict)}</td>
      </tr>`
        )
        .join('');

    const statusClass = d.isFinished
        ? parseFloat(d.score) >= 100
            ? 'ac'
            : 'wa'
        : 'pending';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    padding: 20px 32px; line-height: 1.7;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background); }
  h1 { font-size: 20px; margin-bottom: 12px; }
  table { border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 6px 12px; border: 1px solid var(--vscode-panel-border); text-align: left; }
  th { background: var(--vscode-editorWidget-background); }
  .ac { color: #4caf50; font-weight: bold; }
  .wa { color: #f44336; font-weight: bold; }
  .tle { color: #ff9800; font-weight: bold; }
  .pending { color: #2196f3; font-weight: bold; }
  pre { background: var(--vscode-textCodeBlock-background);
    padding: 12px; overflow-x: auto; border-radius: 4px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 13px; }
</style>
</head>
<body>
  <h1>提交 #${d.id}</h1>
  <p class="meta">
    ${esc(d.userDisplay)} &nbsp;|&nbsp; ${esc(d.submitTime)}
    &nbsp;|&nbsp; ${esc(d.language)} &nbsp;|&nbsp; ${esc(d.length)}
  </p>
  <p>
    题目: ${d.problemUrl ? `<a href="https://wzoi.cn${esc(d.problemUrl)}">${esc(d.problemTitle)}</a>` : esc(d.problemTitle)}
  </p>
  <p>
    分数: <span class="${statusClass}">${esc(d.score)}</span>
    &nbsp;|&nbsp; 状态: <span class="${statusClass}">${esc(d.status)}</span>
    &nbsp;|&nbsp; 耗时: ${esc(d.time)}
    &nbsp;|&nbsp; 内存: ${esc(d.memory)}
  </p>

  ${tests ? `<h3>测试点</h3><table>
    <tr><th>测试点</th><th>分数</th><th>耗时</th><th>内存</th><th>结果</th></tr>
    ${tests}
  </table>` : ''}

  ${d.code ? `<h3>代码</h3><pre><code>${esc(d.code)}</code></pre>` : ''}
</body>
</html>`;
}