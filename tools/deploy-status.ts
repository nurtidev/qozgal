/**
 * Что на самом деле крутится на проде.
 *
 * Автодеплой по пушу в этом проекте не срабатывает — вебхук GitHub → Railway
 * молчит, и каждый деплой запускается вручную. Пока это так, сервисы тихо
 * разъезжаются: 19.08 web работал на последнем коммите, а бот — на коммите
 * четырёхдневной давности, и заметить это можно было только случайно.
 *
 * Цена расхождения не в самом факте, а в диагностике: правка, которая
 * «не доехала», выглядит как невоспроизводимый баг. Час уходит на поиск
 * ошибки в коде, которого на проде нет.
 *
 * Скрипт ничего не меняет и не деплоит — только сверяет SHA сервисов
 * с origin/main. Запуск:
 *   npm run deploy:status
 *
 * Требует авторизованный railway CLI, привязанный к проекту (railway link).
 */

import { execFileSync } from 'node:child_process';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

type Service = {
  name: string;
  sha: string | null;
  status: string | null;
  createdAt: string | null;
};

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Коммит есть в локальном репозитории — иначе про него нечего сказать */
function known(sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function services(): Service[] {
  const raw = execFileSync('railway', ['status', '--json'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  const out: Service[] = [];

  for (const env of data.environments?.edges ?? []) {
    for (const instance of env.node?.serviceInstances?.edges ?? []) {
      const node = instance.node;
      const deployment = node.latestDeployment ?? {};
      const meta = deployment.meta ?? {};
      // Postgres развёрнут из образа — сверять его с git бессмысленно
      if (!meta.commitHash) continue;
      out.push({
        name: node.serviceName,
        sha: meta.commitHash,
        status: deployment.status ?? null,
        createdAt: deployment.createdAt ?? null,
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  git('fetch', 'origin', 'main', '--quiet');
  const target = git('rev-parse', 'origin/main');
  const head = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain') !== '';

  console.log(`\norigin/main  ${target.slice(0, 8)}  ${DIM}${git('log', '-1', '--format=%s', target)}${RESET}`);
  if (head !== target) {
    console.log(`${YELLOW}локальный HEAD ${head.slice(0, 8)} не совпадает с origin/main — коммит не запушен?${RESET}`);
  }
  if (dirty) {
    console.log(`${YELLOW}рабочее дерево грязное — на проде этих правок нет по определению${RESET}`);
  }
  console.log();

  let behind = false;

  for (const service of services()) {
    const sha = service.sha!;
    const short = sha.slice(0, 8);
    const ok = service.status === 'SUCCESS';

    let lag = '';
    if (sha === target) {
      lag = `${GREEN}на origin/main${RESET}`;
    } else if (known(sha)) {
      const count = git('rev-list', '--count', `${sha}..${target}`);
      lag = Number(count) > 0
        ? `${RED}отстаёт на ${count} коммит(ов)${RESET}`
        : `${YELLOW}впереди origin/main${RESET}`;
      behind = true;
    } else {
      lag = `${YELLOW}коммита нет локально${RESET}`;
      behind = true;
    }

    const when = service.createdAt
      ? new Date(service.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })
      : '—';
    const state = ok ? `${DIM}${service.status}${RESET}` : `${RED}${service.status}${RESET}`;

    console.log(`${service.name.padEnd(8)} ${short}  ${lag}`);
    console.log(`${' '.repeat(9)}${DIM}${when} · ${RESET}${state}`);
    if (known(sha)) {
      console.log(`${' '.repeat(9)}${DIM}${git('log', '-1', '--format=%s', sha)}${RESET}`);
    }
    console.log();
  }

  if (behind) {
    console.log(`${DIM}Деплой конкретного коммита — в дашборде Railway или через Railway API${RESET}`);
    console.log(`${DIM}(serviceInstanceDeploy с commitSha); railway redeploy повторяет тот же образ.${RESET}\n`);
    process.exitCode = 1;
  }
}

main();
