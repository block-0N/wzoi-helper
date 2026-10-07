import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface TestCase {
  name: string;
  input: string;
  expected: string;
}

export interface TestResult {
  name: string;
  input: string;
  expected: string;
  actual: string;
  timeMs: number;
  verdict: 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' | 'SKIP';
  error?: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timeMs: number;
  timedOut: boolean;
}

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  stdin: string,
  useShell: boolean
): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, { cwd, shell: useShell });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch { }
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: stderr + '\n' + err.message,
        timeMs: Date.now() - start,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        timeMs: Date.now() - start,
        timedOut,
      });
    });

    if (stdin) {
      try {
        child.stdin?.write(stdin);
      } catch { }
    }
    try {
      child.stdin?.end();
    } catch { }
  });
}

function loadTestCases(dir: string): TestCase[] {
  const files = fs.readdirSync(dir);
  const inFiles = files
    .filter((f) => f.endsWith('.in'))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

  const cases: TestCase[] = [];
  for (const inFile of inFiles) {
    const name = inFile.replace(/\.in$/, '');
    const outFile = name + '.out';
    if (!files.includes(outFile)) continue;
    cases.push({
      name,
      input: fs.readFileSync(path.join(dir, inFile), 'utf8'),
      expected: fs.readFileSync(path.join(dir, outFile), 'utf8'),
    });
  }
  return cases;
}

export interface TesterOptions {
  /** 样例目录 */
  dir: string;
  /** 相对于 dir 的源文件名，比如 main.cpp */
  sourceFile: string;
  /** 时间限制 ms */
  timeLimitMs: number;
  /** 输出面板 */
  output: vscode.OutputChannel;
}

export async function runTests(opts: TesterOptions): Promise<TestResult[]> {
  const { dir, sourceFile, timeLimitMs, output } = opts;
  const cfg = vscode.workspace.getConfiguration('wzoi');
  const compiler = cfg.get<string>('compilerPath') || 'g++';
  const extraFlags = cfg.get<string[]>('extraCompileFlags') || [
    '-std=c++17',
    '-O2',
  ];

  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'main.exe' : 'main';
  const exePath = path.join(dir, exeName);

  // 清理旧产物
  try {
    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
  } catch { }

  // 编译
  output.appendLine(
    `[编译] ${compiler} ${extraFlags.join(' ')} -o ${exeName} ${sourceFile}`
  );
  const compileRes = await runProcess(
    compiler,
    [...extraFlags, '-o', exePath, sourceFile],
    dir,
    30000,
    '',
    isWin
  );

  if (compileRes.code !== 0 || !fs.existsSync(exePath)) {
    output.appendLine('[编译失败]');
    if (compileRes.stdout) output.appendLine(compileRes.stdout);
    if (compileRes.stderr) output.appendLine(compileRes.stderr);
    return [
      {
        name: 'compile',
        input: '',
        expected: '',
        actual: '',
        timeMs: 0,
        verdict: 'CE',
        error: compileRes.stderr,
      },
    ];
  }
  output.appendLine('[编译成功]');

  // 找测试点
  const tests = loadTestCases(dir);
  if (!tests.length) {
    output.appendLine('[警告] 目录里没有 .in/.out 文件');
    return [];
  }

  const results: TestResult[] = [];
  const runTimeout = Math.max(timeLimitMs * 3, 1000);

  for (const tc of tests) {
    output.appendLine('');
    output.appendLine(`[测试 ${tc.name}]`);

    const runRes = await runProcess(exePath, [], dir, runTimeout, tc.input, false);

    let verdict: TestResult['verdict'] = 'AC';
    if (runRes.timedOut) verdict = 'TLE';
    else if (runRes.code !== 0) verdict = 'RE';
    else if (normalize(runRes.stdout) !== normalize(tc.expected)) verdict = 'WA';

    results.push({
      name: tc.name,
      input: tc.input,
      expected: tc.expected,
      actual: runRes.stdout,
      timeMs: runRes.timeMs,
      verdict,
    });

    if (verdict === 'AC') {
      output.appendLine(`✅ AC (${runRes.timeMs}ms)`);
    } else if (verdict === 'WA') {
      output.appendLine(`❌ WA (${runRes.timeMs}ms)`);
      output.appendLine('--- 期望输出 ---');
      output.appendLine(tc.expected.trimEnd());
      output.appendLine('--- 实际输出 ---');
      output.appendLine(runRes.stdout.trimEnd());
    } else if (verdict === 'TLE') {
      output.appendLine(`⏰ TLE (>${runTimeout}ms)`);
    } else if (verdict === 'RE') {
      output.appendLine(`💥 RE (exit ${runRes.code})`);
      if (runRes.stderr) output.appendLine(runRes.stderr);
    }
  }

  return results;
}