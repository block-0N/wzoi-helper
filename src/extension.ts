import * as vscode from 'vscode';
import {
  fetchProblem,
  fetchSolution,
  fetchCurrentUsername,
  fetchAllMySubmissions,
  buildScoreIndex,
  fetchDashboard,
  fetchTags,
  searchByTag,
  waitForSolution,
  searchProblems,
  searchUsers,
  fetchUserProfile,
  fetchUserSubmissions
} from './api/wzoi';
import { loginWithPassword } from './api/auth';
import { submitSolution, guessLanguage, LANGUAGE_OPTIONS } from './api/submit';
import { ProblemTreeProvider, ProblemNode } from './tree/problemTree';
import { SubmissionTreeProvider } from './tree/submissionTree';
import { ContestTreeProvider } from './tree/contestTree';
import { ProblemPanel } from './webview/problemPanel';
import { SolutionPanel } from './webview/solutionPanel';
import { DashboardPanel } from './webview/dashboardPanel';
import { UserPanel } from './webview/userPanel';
import { SubmissionListPanel } from './webview/submissionListPanel';
import * as path from 'path';
import { ensureProblemWorkspace } from './workspace/problemWorkspace';
import { runTests } from './runner/tester';
export function activate(context: vscode.ExtensionContext) {
  console.log('wzoi-helper is now active!');

  // ---------- 公共 helper ----------
  const getCookie = async (): Promise<string | undefined> => {
    return await context.secrets.get('wzoi.cookie');
  };
  const getUsername = async (): Promise<string | undefined> => {
    return await context.secrets.get('wzoi.username');
  };
  const wzoiOutput = vscode.window.createOutputChannel('WZOI');
  context.subscriptions.push(wzoiOutput);
  wzoiOutput.appendLine('WZOI 扩展已激活');
  // ---------- Providers ----------
  const treeProvider = new ProblemTreeProvider(getCookie);
  const treeView = vscode.window.createTreeView('wzoiProblems', {
    treeDataProvider: treeProvider,
  });
  treeProvider.attachTreeView(treeView);
  const submissionProvider = new SubmissionTreeProvider(getCookie, getUsername);
  const submissionView = vscode.window.createTreeView('wzoiSubmissions', {
    treeDataProvider: submissionProvider,
  });

  const contestProvider = new ContestTreeProvider(getCookie);
  const contestView = vscode.window.createTreeView('wzoiContests', {
    treeDataProvider: contestProvider,
  });

  // ---------- 命令：Hello World（保留自脚手架）----------
  const hello = vscode.commands.registerCommand('wzoi-helper.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from wzoi-helper!');
  });

  // ---------- 命令：输入 ID 抓题 ----------
  const fetch = vscode.commands.registerCommand(
    'wzoi-helper.fetchProblem',
    async () => {
      const id = await vscode.window.showInputBox({
        prompt: '输入题目 ID（例如 205）',
        placeHolder: '205',
        validateInput: (v) => (/^\d+$/.test(v) ? null : '请输入数字'),
      });
      if (!id) return;
      try {
        const problem = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `正在抓取题目 ${id}...`,
            cancellable: false,
          },
          () => fetchProblem(id, '1', undefined)
        );
        // 用 Webview 打开
        ProblemPanel.createOrShow(context.extensionUri, problem, '1', wzoiOutput);
        vscode.window.showInformationMessage(`题目 ${id} 抓取成功`);
      } catch (err) {
        vscode.window.showErrorMessage(`抓取失败: ${err}`);
      }
    }
  );

  // ---------- 命令：刷新 ----------
  const refresh = vscode.commands.registerCommand(
    'wzoi-helper.refreshProblems',
    () => {
      treeProvider.refresh();
      submissionProvider.refresh();
      contestProvider.refresh();
    }
  );

  // ---------- 命令：从侧边栏打开题目 ----------
  const openProblem = vscode.commands.registerCommand(
    'wzoi-helper.openProblem',
    async (problemsetId: string, problemId: string) => {
      try {
        const cookie = await getCookie();
        const problem = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载题目 ${problemId}...`,
            cancellable: false,
          },
          () => fetchProblem(problemId, problemsetId, cookie)
        );
        ProblemPanel.createOrShow(context.extensionUri, problem, problemsetId, wzoiOutput);
      } catch (err) {
        vscode.window.showErrorMessage(`打开题目失败: ${err}`);
      }
    }
  );

  // ---------- 命令：登录（用户名密码）----------
  const loginPassword = vscode.commands.registerCommand(
    'wzoi-helper.loginPassword',
    async () => {
      const username = await vscode.window.showInputBox({
        prompt: 'WZOI 用户名',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : '不能为空'),
      });
      if (!username) return;

      const password = await vscode.window.showInputBox({
        prompt: 'WZOI 密码',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v ? null : '不能为空'),
      });
      if (!password) return;

      try {
        const cookie = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在登录 WZOI...',
          },
          () => loginWithPassword(username.trim(), password)
        );

        await context.secrets.store('wzoi.cookie', cookie);
        await context.secrets.store('wzoi.username', username.trim());
        await context.secrets.store('wzoi.password', password);

        // 尝试解析真实用户名（用于提交列表）
        try {
          const realName = await fetchCurrentUsername(cookie);
          if (realName) {
            await context.secrets.store('wzoi.username', realName);
          }
        } catch {
          /* 忽略 */
        }

        vscode.window.showInformationMessage('WZOI 登录成功');
        treeProvider.refresh();
        submissionProvider.refresh();
        contestProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`登录失败: ${err}`);
      }
    }
  );

  // ---------- 命令：退出登录 ----------
  const logout = vscode.commands.registerCommand(
    'wzoi-helper.logout',
    async () => {
      await context.secrets.delete('wzoi.cookie');
      await context.secrets.delete('wzoi.username');
      await context.secrets.delete('wzoi.password');
      vscode.window.showInformationMessage('已退出 WZOI');
      treeProvider.refresh();
      submissionProvider.refresh();
      contestProvider.refresh();
    }
  );

  // ---------- 命令：提交代码到题目 ----------
  const submitToProblem = vscode.commands.registerCommand(
    'wzoi-helper.submitToProblem',
    async (node: ProblemNode) => {
      if (!node?.summary) {
        vscode.window.showErrorMessage('请从侧边栏的题目上右键提交');
        return;
      }
      const { problemsetId, problemId } = node.summary;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('请先打开要提交的代码文件');
        return;
      }

      const code = editor.selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(editor.selection);
      if (!code.trim()) {
        vscode.window.showErrorMessage('代码为空');
        return;
      }

      const guessed = guessLanguage(editor.document.fileName);
      const pick = await vscode.window.showQuickPick(
        LANGUAGE_OPTIONS.map((o) => ({
          label: o.label,
          description: o.ext.join(', '),
          id: o.id,
        })),
        {
          placeHolder: guessed
            ? `选择语言（根据扩展名推测：${guessed.label}）`
            : '选择语言',
        }
      );
      if (!pick) return;

      const cookie = await getCookie();
      if (!cookie) {
        vscode.window.showWarningMessage('请先使用「WZOI: 登录」登录');
        return;
      }

      // 1) 提交
      let solutionId: number;
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `提交至题库 ${problemsetId} 题目 ${problemId}...`,
          },
          () => submitSolution(problemsetId, problemId, code, pick.id, cookie)
        );
        solutionId = result.solutionId;
        submissionProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`提交失败: ${err}`);
        return;
      }

      // 2) 轮询等待评测结果
      let finalDetail: import('./api/wzoi').SolutionDetail | undefined;
      let wasCancelled = false;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `提交 #${solutionId} 评测中...`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            finalDetail = await waitForSolution(solutionId, cookie, {
              onProgress: (status) => progress.report({ message: status }),
              shouldCancel: () => token.isCancellationRequested,
            });
          } catch (e) {
            if (String(e).includes('已取消')) {
              wasCancelled = true;
            } else {
              vscode.window.showErrorMessage(`等待评测失败: ${e}`);
            }
          }
        }
      );

      // 3) 无论是否取消，都刷新一次列表
      submissionProvider.refresh();

      if (wasCancelled || !finalDetail) return;

      // 4) 结果通知
      const scoreNum = parseFloat(finalDetail.score);
      let verdictText: string;
      let level: 'info' | 'warning' | 'error' = 'info';

      if (finalDetail.status.includes('编译错误')) {
        verdictText = '编译错误 (CE)';
        level = 'error';
      } else if (!finalDetail.isFinished) {
        verdictText = `评测未完成：${finalDetail.status}`;
        level = 'warning';
      } else if (scoreNum >= 100) {
        verdictText = 'AC 100';
        level = 'info';
      } else if (scoreNum > 0) {
        verdictText = `${scoreNum} 分`;
        level = 'warning';
      } else {
        verdictText = '未通过 (0 分)';
        level = 'error';
      }

      const message = `提交 #${solutionId}：${verdictText}`;
      const view = '查看详情';

      let action: string | undefined;
      if (level === 'error') {
        action = await vscode.window.showErrorMessage(message, view);
      } else if (level === 'warning') {
        action = await vscode.window.showWarningMessage(message, view);
      } else {
        action = await vscode.window.showInformationMessage(message, view);
      }

      if (action === view) {
        SolutionPanel.createOrShow(context.extensionUri, finalDetail);
      }
    }
  );

  // ---------- 命令：查看提交详情 ----------
  const openSolution = vscode.commands.registerCommand(
    'wzoi-helper.openSolution',
    async (id: number) => {
      try {
        const cookie = await getCookie();
        const detail = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载提交 #${id}...`,
          },
          () => fetchSolution(id, cookie)
        );
        SolutionPanel.createOrShow(context.extensionUri, detail);
      } catch (err) {
        vscode.window.showErrorMessage(`加载提交失败: ${err}`);
      }
    }
  );

  // ---------- 命令：从侧边栏打开比赛 ----------
  const openProblemset = vscode.commands.registerCommand(
    'wzoi-helper.openProblemset',
    async (problemsetId: string) => {
      const cfg = vscode.workspace.getConfiguration('wzoi');
      const ids = cfg.get<string[]>('problemsets') ?? [];
      if (!ids.includes(problemsetId)) {
        await cfg.update(
          'problemsets',
          [...ids, problemsetId],
          vscode.ConfigurationTarget.Global
        );
        treeProvider.refresh();
        // 等 VSCode 处理完配置更新再 reveal
        await new Promise((r) => setTimeout(r, 200));
      }
      await treeProvider.revealProblemset(problemsetId);
    }
  );
  const syncACStatus = vscode.commands.registerCommand(
    'wzoi-helper.syncACStatus',
    async () => {
      const username = await getUsername();
      const cookie = await getCookie();
      if (!username || !cookie) {
        vscode.window.showWarningMessage('请先登录');
        return;
      }
      try {
        const subs = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '同步提交记录...',
            cancellable: false,
          },
          () => fetchAllMySubmissions(username, cookie)
        );
        const index = buildScoreIndex(subs);
        treeProvider.setScoreIndex(index);
        vscode.window.showInformationMessage(
          `已同步 ${subs.length} 条提交，覆盖 ${index.size} 道题`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`同步失败: ${err}`);
      }
    }
  );
  const openDashboard = vscode.commands.registerCommand(
    'wzoi-helper.openDashboard',
    async () => {
      try {
        const cookie = await getCookie();
        const data = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '加载首页...',
          },
          () => fetchDashboard(cookie)
        );
        DashboardPanel.createOrShow(data);
      } catch (err) {
        vscode.window.showErrorMessage(`加载失败: ${err}`);
      }
    }
  );
  const searchByTagCmd = vscode.commands.registerCommand(
    'wzoi-helper.searchByTag',
    async () => {
      try {
        const tags = await fetchTags();
        const pick = await vscode.window.showQuickPick(
          tags.map((t) => ({ label: t.name, id: t.id })),
          { placeHolder: '选择标签' }
        );
        if (!pick) return;

        const cookie = await getCookie();
        const problems = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `搜索标签「${pick.label}」...`,
            cancellable: false,
          },
          (progress) =>
            searchByTag(pick.id, cookie, (page, total) => {
              progress.report({
                message: total > 1 ? `第 ${page}/${total} 页` : undefined,
              });
            })
        );

        if (!problems.length) {
          vscode.window.showInformationMessage('没有找到题目');
          return;
        }

        const probPick = await vscode.window.showQuickPick(
          problems.map((p) => ({
            label: p.title,
            description: `#${p.problemId}`,
            detail: p.problemsetTitle
              ? `来自 ${p.problemsetTitle}（题库 ${p.problemsetId}）`
              : `题库 ${p.problemsetId}`,
            p,
          })),
          { placeHolder: `共 ${problems.length} 道题，选择要打开的` }
        );
        if (probPick) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            probPick.p.problemsetId,
            probPick.p.problemId
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`搜索失败: ${err}`);
      }
    }
  );
  // ---------- 命令：从主页链接直达（无交互）----------
  const openUserSubmissions = vscode.commands.registerCommand(
    'wzoi-helper.openUserSubmissions',
    async (userName: string, filter: 'all' | 'ac') => {
      try {
        const cookie = await getCookie();
        const filters: import('./api/wzoi').SubmissionFilters = {
          userName,
          scoreMin: filter === 'ac' ? '100' : '',
          scoreMax: filter === 'ac' ? '100' : '',
        };
        const title =
          filter === 'ac' ? `${userName} 的通过题目` : `${userName} 的提交记录`;

        const items = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载 ${title}...`,
          },
          (progress) =>
            fetchUserSubmissions(filters, cookie, (page, count) => {
              progress.report({ message: `第 ${page} 页 · 已加载 ${count} 条` });
            })
        );

        if (!items.length) {
          vscode.window.showInformationMessage('没有找到提交记录');
          return;
        }

        SubmissionListPanel.createOrShow(title, items);
      } catch (err) {
        vscode.window.showErrorMessage(`加载提交记录失败: ${err}`);
      }
    }
  );

  // ---------- 命令：命令面板交互式查询 ----------
  const openSubmissions = vscode.commands.registerCommand(
    'wzoi-helper.openSubmissions',
    async () => {
      // 用户名
      const userName = await vscode.window.showInputBox({
        prompt: '用户名（留空则不过滤）',
        placeHolder: '例如：zzyzzy',
        ignoreFocusOut: true,
      });
      if (userName === undefined) return;

      // 题库 ID
      const problemsetId = await vscode.window.showInputBox({
        prompt: '题库 ID（留空则不过滤）',
        placeHolder: '例如：1',
        ignoreFocusOut: true,
      });
      if (problemsetId === undefined) return;

      // 题目 ID
      const problemId = await vscode.window.showInputBox({
        prompt: '题目 ID（留空则不过滤）',
        placeHolder: '例如：205',
        ignoreFocusOut: true,
      });
      if (problemId === undefined) return;

      // 分数
      const rangePick = await vscode.window.showQuickPick(
        [
          { label: '不限制分数', id: 'any' },
          { label: 'AC（100 分）', id: 'ac' },
          { label: '未通过（0 分）', id: 'zero' },
          { label: '部分分（1–99 分）', id: 'partial' },
          { label: '自定义范围...', id: 'custom' },
        ],
        { placeHolder: '分数筛选' }
      );
      if (!rangePick) return;

      let scoreMin = '';
      let scoreMax = '';
      if (rangePick.id === 'ac') {
        scoreMin = scoreMax = '100';
      } else if (rangePick.id === 'zero') {
        scoreMin = scoreMax = '0';
      } else if (rangePick.id === 'partial') {
        scoreMin = '1';
        scoreMax = '99';
      } else if (rangePick.id === 'custom') {
        const min = await vscode.window.showInputBox({
          prompt: '最小分数',
          placeHolder: '0',
          ignoreFocusOut: true,
        });
        if (min === undefined) return;
        const max = await vscode.window.showInputBox({
          prompt: '最大分数',
          placeHolder: '100',
          ignoreFocusOut: true,
        });
        if (max === undefined) return;
        scoreMin = min;
        scoreMax = max;
      }

      // 语言
      const langPick = await vscode.window.showQuickPick(
        [
          { label: '不限语言', id: '' },
          { label: 'C', id: '0' },
          { label: 'C++', id: '1' },
          { label: 'Pascal', id: '2' },
          { label: 'Python', id: '4' },
        ],
        { placeHolder: '语言筛选' }
      );
      if (!langPick) return;

      // 状态
      const statusPick = await vscode.window.showQuickPick(
        [
          { label: '不限状态', id: '' },
          { label: '等待评测', id: '0' },
          { label: '等待重测', id: '1' },
          { label: '正在编译', id: '2' },
          { label: '正在运行', id: '3' },
          { label: '评测完成', id: '4' },
        ],
        { placeHolder: '状态筛选' }
      );
      if (!statusPick) return;

      try {
        const cookie = await getCookie();
        const title = userName.trim()
          ? `${userName.trim()} 的提交记录`
          : '提交记录';

        const items = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载 ${title}...`,
          },
          (progress) =>
            fetchUserSubmissions(
              {
                userName: userName.trim() || undefined,
                problemsetId: problemsetId.trim() || undefined,
                problemId: problemId.trim() || undefined,
                scoreMin,
                scoreMax,
                language: langPick.id || undefined,
                status: statusPick.id || undefined,
              },
              cookie,
              (page, count) => {
                progress.report({ message: `第 ${page} 页 · 已加载 ${count} 条` });
              }
            )
        );

        if (!items.length) {
          vscode.window.showInformationMessage('没有找到提交记录');
          return;
        }

        SubmissionListPanel.createOrShow(title, items);
      } catch (err) {
        vscode.window.showErrorMessage(`加载提交记录失败: ${err}`);
      }
    }
  );
  // ---------- 命令：通用搜索 ----------
  const searchCmd = vscode.commands.registerCommand(
    'wzoi-helper.search',
    async () => {
      const typePick = await vscode.window.showQuickPick(
        [
          {
            label: '$(book) 题目',
            description: '关键词、标签或两者组合',
            id: 'problems',
          },
          {
            label: '$(person) 用户',
            description: '按用户名或昵称搜索',
            id: 'users',
          },
        ],
        { placeHolder: '选择搜索类型' }
      );
      if (!typePick) return;

      if (typePick.id === 'users') {
        await runUserSearch();
      } else {
        await runProblemSearch();
      }
    }
  );

  async function runProblemSearch() {
    // 1. 关键词（可空）
    const keyword = await vscode.window.showInputBox({
      prompt: '输入关键词（可留空，直接选标签）',
      placeHolder: '例如：背包',
      ignoreFocusOut: true,
    });
    if (keyword === undefined) return; // 用户取消

    // 2. 标签（多选，可跳过）
    const tags = await fetchTags();
    if (tags.length) {
      const tagPicks = await vscode.window.showQuickPick(
        tags.map((t) => ({ label: t.name, id: t.id })),
        {
          placeHolder:
            keyword.trim()
              ? '选择标签（可多选，回车跳过）'
              : '至少选择一个标签',
          canPickMany: true,
          ignoreFocusOut: true,
        }
      );
      if (tagPicks === undefined) return; // 用户取消
      const tagIds = tagPicks.map((t) => t.id);

      if (!keyword.trim() && !tagIds.length) {
        vscode.window.showWarningMessage('请至少输入关键词或选择一个标签');
        return;
      }

      const cookie = await getCookie();
      const problems = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '搜索题目...',
        },
        (progress) =>
          searchProblems(keyword.trim(), tagIds, cookie, (page, total) => {
            progress.report({
              message: total > 1 ? `第 ${page}/${total} 页` : undefined,
            });
          })
      );

      if (!problems.length) {
        vscode.window.showInformationMessage('没有找到题目');
        return;
      }

      const probPick = await vscode.window.showQuickPick(
        problems.map((p) => ({
          label: `$(file-code) ${p.title}`,
          description: `#${p.problemId}`,
          detail: p.problemsetTitle
            ? `${p.problemsetTitle}（题库 ${p.problemsetId}）`
            : `题库 ${p.problemsetId}`,
          p,
        })),
        {
          placeHolder: `共 ${problems.length} 道题，选择要打开的`,
          matchOnDescription: true,
          matchOnDetail: true,
        }
      );
      if (probPick) {
        vscode.commands.executeCommand(
          'wzoi-helper.openProblem',
          probPick.p.problemsetId,
          probPick.p.problemId
        );
      }
    }
  }

  async function runUserSearch() {
    const keyword = await vscode.window.showInputBox({
      prompt: '输入用户名或昵称',
      placeHolder: '例如：Massimo',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? null : '不能为空'),
    });
    if (!keyword) return;

    const cookie = await getCookie();
    const users = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '搜索用户...',
      },
      () => searchUsers(keyword.trim(), cookie)
    );

    if (!users.length) {
      vscode.window.showInformationMessage('没有找到用户');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      users.map((u) => ({
        label: `$(person) ${u.nickname || u.username || '用户 ' + u.uid}`,
        description: u.username ? `@${u.username}` : `#${u.uid}`,
        detail: `主页：https://wzoi.cn/users/${u.uid}`,
        u,
      })),
      {
        placeHolder: `共 ${users.length} 个用户，选择要在浏览器中打开`,
        matchOnDescription: true,
      }
    );

    if (pick) {
      try {
        const profile = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载用户 ${pick.u.nickname || pick.u.uid}...`,
          },
          () => fetchUserProfile(pick.u.uid, cookie)
        );
        UserPanel.createOrShow(profile);
      } catch (err) {
        vscode.window.showErrorMessage(`加载用户主页失败: ${err}`);
      }
    }
  }
  const createWorkspace = vscode.commands.registerCommand(
    'wzoi-helper.createWorkspace',
    async (node: ProblemNode) => {
      if (!node?.summary) {
        vscode.window.showErrorMessage('请从侧边栏的题目上右键创建');
        return;
      }
      try {
        const cookie = await getCookie();
        const problem = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `加载题目 ${node.summary.problemId}...`,
          },
          () => fetchProblem(node.summary.problemId, node.summary.problemsetId, cookie)
        );
        const dir = await ensureProblemWorkspace(problem, node.summary.problemsetId);
        if (!dir) return;

        const cppPath = path.join(dir, 'main.cpp');
        const doc = await vscode.workspace.openTextDocument(cppPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`已创建代码工作区: ${dir}`);
      } catch (err) {
        vscode.window.showErrorMessage(`创建失败: ${err}`);
      }
    }
  );

  const runLocalTests = vscode.commands.registerCommand(
    'wzoi-helper.runTests',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('请先打开要测试的代码文件');
        return;
      }
      const srcPath = editor.document.uri.fsPath;
      const dir = path.dirname(srcPath);
      const fileName = path.basename(srcPath);

      const testerOutput = vscode.window.createOutputChannel('WZOI Tester');
      testerOutput.show(true);
      testerOutput.appendLine(`=== 本地测试: ${fileName} ===`);

      const timeLimitMs =
        vscode.workspace.getConfiguration('wzoi').get<number>('defaultTimeLimitMs') ||
        2000;

      try {
        const results = await runTests({
          dir,
          sourceFile: fileName,
          timeLimitMs,
          output: testerOutput,
        });

        if (!results.length) return;

        const ac = results.filter((r) => r.verdict === 'AC').length;
        const total = results.length;
        const allAc = results.every((r) => r.verdict === 'AC');
        const summary = allAc
          ? `✅ 全部通过 (${ac}/${total})`
          : `❌ ${ac}/${total} 通过`;
        testerOutput.appendLine('');
        testerOutput.appendLine(`=== ${summary} ===`);

        if (allAc) {
          vscode.window.showInformationMessage(summary);
        } else {
          vscode.window.showWarningMessage(summary);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`测试失败: ${err}`);
      }
    }
  );
  context.subscriptions.push(
    hello, fetch, refresh, openProblem, loginPassword, logout,
    submitToProblem, openSolution, openProblemset, syncACStatus,
    openDashboard, searchByTagCmd, searchCmd,
    createWorkspace, runLocalTests,
    openSubmissions, openUserSubmissions,
    treeView, submissionView, contestView
  );
}

export function deactivate() { }