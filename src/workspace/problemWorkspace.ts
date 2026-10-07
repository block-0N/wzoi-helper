import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Problem } from '../api/wzoi';
import { CPP_TEMPLATE } from '../templates/cpp';

export async function ensureProblemWorkspace(
  problem: Problem,
  problemsetId: string
): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    const pick = await vscode.window.showWarningMessage(
      '当前没有打开任何文件夹，无法创建代码工作区',
      '打开文件夹'
    );
    if (pick === '打开文件夹') {
      vscode.commands.executeCommand('vscode.openFolder');
    }
    return undefined;
  }

  const root = folders[0].uri.fsPath;
  const sub =
    vscode.workspace.getConfiguration('wzoi').get<string>('workspaceFolder') ||
    'wzoi';
  const dir = path.join(root, sub, problemsetId, problem.id);

  fs.mkdirSync(dir, { recursive: true });

  // main.cpp
  const cppPath = path.join(dir, 'main.cpp');
  if (!fs.existsSync(cppPath)) {
    fs.writeFileSync(cppPath, CPP_TEMPLATE, 'utf8');
  }

  // 样例文件
  for (let i = 0; i < problem.samples.length; i++) {
    const s = problem.samples[i];
    const inPath = path.join(dir, `${i + 1}.in`);
    const outPath = path.join(dir, `${i + 1}.out`);
    if (!fs.existsSync(inPath)) {
      fs.writeFileSync(inPath, (s.input || '').replace(/\r\n/g, '\n') + '\n', 'utf8');
    }
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, (s.output || '').replace(/\r\n/g, '\n') + '\n', 'utf8');
    }
  }

  // 题面备份
  const infoPath = path.join(dir, 'problem.md');
  if (!fs.existsSync(infoPath)) {
    const md = [
      `# ${problem.title}`,
      '',
      `> 时间限制: ${problem.timeLimit || '—'} | 空间限制: ${problem.memoryLimit || '—'}`,
      '',
      '## 题目描述',
      problem.description || '',
      '',
      '## 输入格式',
      problem.inputFormat || '',
      '',
      '## 输出格式',
      problem.outputFormat || '',
    ].join('\n');
    fs.writeFileSync(infoPath, md, 'utf8');
  }

  return dir;
}