# sqlite-mcp-server

Read-only MCP-сервер для SQLite. Работает по stdio, использует
`@modelcontextprotocol/sdk` и `better-sqlite3`. Инструменты:

- `list_tables`, `describe_table`, `run_query` — общего назначения (только
  `SELECT`/`WITH ... SELECT`, с пагинацией и понятными ошибками — подробности
  и обоснование read-only-гарантий в [SPEC.md](./SPEC.md));
- `top_customers_by_spend`, `top_selling_products`, `revenue_by_category`,
  `customers_by_order_count` — специализированные tools под частые вопросы
  аналитики магазина, чтобы агенту не приходилось каждый раз писать JOIN руками.

Параметры и формат ответа каждого — в разделе [MCP tools](#mcp-tools).

## Быстрый старт

Два способа запустить — выберите один.

**A. Локально через Node.js** (Windows, macOS, Linux — команды одинаковые):

```bash
npm install
npm run build
npm start -- /путь/к/вашей.db
```

Подробности: [Requirements](#requirements) → [Configure](#configure) →
[Run](#run) → [Connect to agent](#connect-to-agent).

**B. В Docker** (Node.js на машине не нужен):

```bash
docker build -t sqlite-mcp-server .
docker run -i --rm -v /путь/к/вашей.db:/data/shop.db:ro -e DB_PATH=/data/shop.db sqlite-mcp-server
```

Подробности, включая синтаксис путей для Windows: [Docker](#docker).

Сервер сам по себе — не интерактивная программа: запущенный вручную, он просто
ждёт JSON-RPC на stdin. Практический смысл появляется, когда его запускает
MCP-хост (Claude Code, Claude Desktop) — см. [Connect to agent](#connect-to-agent).

## Requirements

- **Node.js 18 или новее** (проверено на 18 и 20; в Docker-образе — 20 LTS).
  Проверить: `node -v`.
- Любая из платформ: **Linux, macOS (Intel и Apple Silicon), Windows 10/11**.
- `better-sqlite3` — нативный модуль. При `npm install` обычно скачивается
  готовый бинарник под вашу связку ОС/Node, компилятор не нужен. Если готового
  бинарника нет, npm соберёт его из исходников, и тогда потребуется:
  - **Windows** — [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
    с компонентом «Desktop development with C++» (Python 3 ставится вместе с ними);
  - **macOS** — Xcode Command Line Tools: `xcode-select --install`;
  - **Linux** — `build-essential` и `python3`.

  Если вы сменили мажорную версию Node.js уже после установки — пересоберите
  модуль: `npm rebuild better-sqlite3`.

Docker-вариант ничего из этого не требует — см. [Docker](#docker).

## Install

Проект на Node.js/TypeScript — зависимости описаны в `package.json` /
`package-lock.json` (это источник истины для `npm`); `requirements.txt` в
корне проекта — их текстовое зеркало для чек-листов, ожидающих такой файл.

```bash
npm install
npm run build   # компиляция TypeScript -> dist/index.js
```

Обе команды одинаковы во всех ОС и оболочках (bash, zsh, PowerShell, cmd).

## Configure

Серверу нужен путь к файлу SQLite. Передать его можно двумя способами —
**первым аргументом командной строки** (одинаково работает везде) или
**переменной окружения `DB_PATH`** (синтаксис зависит от оболочки).

Относительный путь резолвится от корня этого проекта (папки, где лежит
`package.json`), а не от текущей директории, из которой запущена команда, —
поэтому сервер одинаково находит БД, откуда бы MCP-хост его ни запустил.

Путь к БД нигде не захардкожен в коде: если он не задан ни одним из способов,
процесс завершится с понятной ошибкой в stderr и кодом 1, не открывая транспорт.

### Способ 1 — аргументом (рекомендуется, кросс-платформенно)

```bash
npm start -- ../sqlitedb/shop.db
```

Всё, что идёт после `--`, npm передаёт скрипту. Кавычки нужны, если в пути есть
пробелы: `npm start -- "C:\Users\Иван\My Data\shop.db"`.

### Способ 2 — переменной окружения

**macOS / Linux (bash, zsh):**

```bash
export DB_PATH=/absolute/or/relative/path/to/your.db
npm start
```

**Windows (PowerShell):**

```powershell
$env:DB_PATH = "C:\path\to\your.db"
npm start
```

**Windows (cmd.exe):**

```bat
set DB_PATH=C:\path\to\your.db
npm start
```

Обратите внимание: в PowerShell и cmd переменная живёт только до закрытия окна.
Чтобы задать её постоянно в Windows — «Параметры → Система → О системе →
Дополнительные параметры системы → Переменные среды».

### Про `.env`

Пример конфигурации — в [`.env.example`](./.env.example). Сервер **не** загружает
`.env` автоматически (нет зависимости `dotenv`), он читает только переменные
окружения. В bash/zsh файл можно подгрузить вручную:

```bash
cp .env.example .env
set -a; source .env; set +a
```

В PowerShell аналога `source` нет — проще воспользоваться способом 1 (аргументом)
или задать `$env:DB_PATH` вручную. При подключении к MCP-хосту `.env` не участвует
вовсе: путь задаётся прямо в конфиге хоста (см. [Connect to agent](#connect-to-agent)).

## Run

```bash
npm run build                        # один раз после npm install и после правок в src/
npm start -- ../sqlitedb/shop.db     # запуск (или npm start, если задан DB_PATH)
```

Для разработки — без пересборки, прямо из TypeScript:

```bash
npm run dev -- ../sqlitedb/shop.db
```

Сервер общается по stdio и ничего не печатает в stdout, кроме JSON-RPC-сообщений
протокола MCP, — это нормально, отдельного сообщения «он запустился» не будет.
Терминал будет выглядеть «зависшим»: процесс ждёт запросы на stdin. Так и должно
быть — обычно его запускает не человек, а MCP-хост. Остановить: `Ctrl+C`.

Ошибки конфигурации (например, неверный `DB_PATH`) печатаются в stderr, и процесс
завершается с кодом 1.

## Connect to agent

В примерах ниже подставьте свои пути — и к `dist/index.js`, и к файлу БД.
Оба должны быть **абсолютными**: MCP-хост запускает сервер из своей рабочей
директории, а не из вашей.

- macOS / Linux: `/Users/ivan/sqlite-mcp-server/dist/index.js`
- Windows: `C:\Users\Ivan\sqlite-mcp-server\dist\index.js`

Перед подключением обязательно выполните `npm install && npm run build` —
хост запускает уже скомпилированный `dist/index.js`.

### Claude Code (CLI)

**macOS / Linux:**

```bash
claude mcp add sqlite-db -s local \
  -e DB_PATH=/absolute/path/to/your.db \
  -- node /absolute/path/to/sqlite-mcp-server/dist/index.js
```

**Windows (PowerShell):**

```powershell
claude mcp add sqlite-db -s local `
  -e DB_PATH=C:\path\to\your.db `
  -- node C:\path\to\sqlite-mcp-server\dist\index.js
```

`-s local` — конфиг виден только вам в текущем проекте (не коммитится в git).
Для командного `.mcp.json` (`-s project`) `DB_PATH` всё равно должен задаваться
каждым разработчиком отдельно: абсолютный путь к локальному файлу БД непереносим
между машинами.

Проверить подключение:

```bash
claude mcp get sqlite-db
```

Ожидаемый статус — `✔ Connected`.

### Claude Desktop и другие MCP-хосты

Добавьте stdio-сервер в конфиг хоста. У Claude Desktop это файл
`claude_desktop_config.json` (Settings → Developer → Edit Config):

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**macOS / Linux:**

```json
{
  "mcpServers": {
    "sqlite-db": {
      "command": "node",
      "args": ["/absolute/path/to/sqlite-mcp-server/dist/index.js"],
      "env": { "DB_PATH": "/absolute/path/to/your.db" }
    }
  }
}
```

**Windows** — то же самое, но обратные слэши в JSON нужно удваивать (`\\`),
либо просто использовать прямые (`/`), которые Node понимает и в Windows:

```json
{
  "mcpServers": {
    "sqlite-db": {
      "command": "node",
      "args": ["C:\\Users\\Ivan\\sqlite-mcp-server\\dist\\index.js"],
      "env": { "DB_PATH": "C:\\Users\\Ivan\\data\\shop.db" }
    }
  }
}
```

После перезапуска хоста агенту станут доступны все инструменты сервера.

### Если сервер не подключается

| Симптом | Причина и что делать |
|---|---|
| `Cannot find module .../dist/index.js` | Не выполнен `npm run build`, либо путь в конфиге указывает не туда |
| `Missing database path` | Не задан ни `DB_PATH`, ни аргумент — см. [Configure](#configure) |
| `Could not open database at "..."` | Файла БД нет по этому пути, либо нет прав на чтение. В Windows проверьте, что путь в JSON записан с `\\` или `/` |
| `command not found: node` / хост не стартует сервер | `node` недоступен в PATH того процесса, который запускает хост. Укажите в `command` полный путь к исполняемому файлу Node (`/usr/local/bin/node`, `C:\\Program Files\\nodejs\\node.exe`) |
| `NODE_MODULE_VERSION ... does not match` | Нативный модуль собран под другую версию Node — `npm rebuild better-sqlite3` |

## MCP tools

Сервер отдаёт 7 инструментов. Все помечены `readOnlyHint: true`,
`idempotentHint: true`, `openWorldHint: false` — ни один не пишет в базу.
Результат всегда возвращается как JSON-текст; ошибка — как `isError: true` с
подсказкой, что делать дальше (несуществующая таблица, опечатка в колонке,
синтаксическая ошибка), без Node-стектрейса.

### Общего назначения

#### `list_tables`

Параметров нет. Возвращает все таблицы базы (кроме служебных `sqlite_%`) с их
колонками — точка входа для агента, чтобы узнать, какие данные вообще есть.

```json
[{ "table": "customers",
   "columns": [{ "name": "id", "type": "INTEGER", "notNull": false, "primaryKey": true }] }]
```

Не возвращает количество строк и примеры данных — для этого `describe_table`.

#### `describe_table`

| Параметр | Тип | По умолч. | Описание |
|---|---|---|---|
| `table` | `string` | — | Точное имя таблицы (регистрозависимо), как в `list_tables` |

Возвращает `{ table, columns, rowCount, sample }`: схему колонок
(`PRAGMA table_info`), точное число строк (`COUNT(*)`) и до 3 примеров строк.
Если таблицы нет — `isError` с подсказкой вызвать `list_tables`.

#### `run_query`

Произвольный read-only SQL с пагинацией.

| Параметр | Тип | По умолч. | Описание |
|---|---|---|---|
| `sql` | `string` | — | Один `SELECT` или `WITH ... SELECT`, **без собственного `LIMIT`/`OFFSET`** |
| `limit` | `int` 1–200 | `100` | Сколько строк вернуть в этой странице |
| `offset` | `int` ≥ 0 | `0` | Сколько строк пропустить |

Возвращает страницу результата:

```json
{ "rows": [...], "returned": 100, "limit": 100, "offset": 0,
  "hasMore": true, "nextOffset": 100 }
```

`hasMore`/`nextOffset` позволяют пройти весь результат постранично, не утонув в
тысячах строк за один вызов; собственный `ORDER BY` запроса сохраняется между
страницами. Запросы, изменяющие данные или схему
(`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`PRAGMA`/`REPLACE INTO`), а
также несколько statement'ов за вызов — отклоняются (см.
[SPEC.md §5](./SPEC.md), три независимых слоя защиты).

### Специализированные (схема магазина)

Готовые версии JOIN'ов, которые иначе агенту приходилось бы писать руками при
каждом вопросе «топ N ...». Завязаны на таблицы
`customers` / `orders` / `order_items` / `products`; на базе без них вернут
понятную ошибку `no such table`, а не упадут.

| Tool | Параметры | Возвращает |
|---|---|---|
| `top_customers_by_spend` | `limit` (1–50, def. `10`), `excludeCancelled` (def. `true`) | Клиенты по сумме заказов: `id`, `first_name`, `last_name`, `email`, `total_spent` |
| `top_selling_products` | `limit` (1–50, def. `10`), `rankBy`: `units_sold` \| `revenue` (def. `units_sold`), `excludeCancelled` (def. `true`) | Товары-бестселлеры: `name`, `category`, `units_sold`, `revenue` |
| `revenue_by_category` | `limit` (1–50, def. `10`), `excludeCancelled` (def. `true`) | Категории по выручке: `category`, `revenue`, `units_sold` |
| `customers_by_order_count` | `limit` (1–50, def. `10`) | Клиенты по числу заказов (**все** статусы): `id`, `first_name`, `last_name`, `email`, `orders_count` |

`excludeCancelled` (по умолчанию `true`) исключает из подсчёта заказы со
статусом `cancelled`. У `customers_by_order_count` этого параметра нет: он
ранжирует по количеству заказов всех статусов — для ранжирования по деньгам
нужен `top_customers_by_spend`.

## Структура кода

```
src/
  index.ts            точка входа: читает конфиг, открывает БД, поднимает stdio-транспорт
  config.ts           резолв пути к БД (DB_PATH / argv) относительно корня проекта
  db.ts               открытие БД read-only, экранирование идентификаторов, проверка таблиц
  errors.ts           ToolError + перевод ошибок SQLite в понятные подсказки
  sql-guard.ts        слой 2 read-only-гарантии: правила допуска SQL в run_query
  server.ts           сборка McpServer и регистрация всех наборов инструментов
  tools/
    register.ts       общая обвязка: readOnly-аннотации, JSON-ответ, обработка ошибок
    schema.ts         list_tables, describe_table
    query.ts          run_query
    analytics.ts      четыре специализированных аналитических инструмента
```

Обработка ошибок и сериализация ответа живут в `tools/register.ts`, поэтому хендлер
инструмента возвращает обычные данные, а отказ выражает через `throw new ToolError(...)` —
`try/catch` и `JSON.stringify` в каждом инструменте не дублируются.

## Tests

Автотесты (`node --test`, встроенный test runner, без доп. фреймворка) — двух уровней.
Юнит-тесты (`tests/sql-guard.test.ts`) вызывают чистые функции напрямую; остальные
поднимают собранный сервер (`dist/index.js`) как реальный MCP stdio-процесс
через `@modelcontextprotocol/sdk`-клиент и гоняют его против детерминированной
фикстур-базы (`tests/fixture.ts` — не связана с `sqlitedb/shop.db`, так что
тесты не зависят от возможной пересборки/реseed'а демо-данных).

```bash
npm test
```

`pretest` сам сделает `npm run build`. Покрытие (53 теста):

| Файл | Что проверяет |
|---|---|
| `tests/schema.test.ts` | `list_tables`/`describe_table`, наличие `title`/description у каждого tool'а, аннотация `readOnlyHint: true`, перекрёстные ссылки между описаниями |
| `tests/read-only.test.ts` | Отказ на `INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/PRAGMA/REPLACE INTO`, обход через CTE и через `;`-склейку, отсутствие write-tool'ов, реальное отсутствие мутаций в БД |
| `tests/pagination.test.ts` | Постраничная выдача `run_query` (`limit`/`offset`/`hasMore`/`nextOffset`), сохранение `ORDER BY` между страницами, жёсткий потолок `limit=200`, запрет на собственный `LIMIT` в запросе |
| `tests/errors.test.ts` | Понятные сообщения на `no such table`/`no such column`/синтаксическую ошибку, отсутствие stack trace в любом ответе tool'а |
| `tests/specialized-tools.test.ts` | Корректность агрегаций всех четырёх специализированных tools, поведение `excludeCancelled`, деградация на БД без нужных таблиц |
| `tests/startup.test.ts` | Чистый (без stack trace) отказ процесса при отсутствующем/невалидном `DB_PATH` |
| `tests/sql-guard.test.ts` | Юнит-тесты правил read-only-фильтра и экранирования идентификаторов — без запуска процесса, поэтому регрессия сразу указывает на конкретную функцию |

## Docker

Docker-вариант не требует ни Node.js, ни компилятора на вашей машине — только
установленный Docker (на Windows и macOS это **Docker Desktop**, на Linux —
`docker` из репозитория дистрибутива). Образ собирается одинаково во всех ОС:

```bash
docker build -t sqlite-mcp-server .
```

### Как это работает

Сервер общается по stdio, а не по сети, поэтому:

- порты не публикуются (`-p` не нужен);
- контейнер запускается **интерактивно, но без TTY**: `-i` **без** `-t` — с `-t`
  Docker подмешает в поток управляющие символы терминала и сломает JSON-RPC;
- файл БД не копируется в образ, а монтируется как volume — образ остаётся
  универсальным, а база остаётся у вас на диске;
- монтируем в режиме `:ro` (read-only) — ещё один слой к read-only-гарантиям.

Внутри контейнера путь к БД — всегда `/data/shop.db` (левая часть `-v` — ваш
реальный путь на хосте, правая — путь внутри контейнера, его и получает `DB_PATH`).

### Запуск

**macOS / Linux (bash, zsh):**

```bash
docker run -i --rm \
  -v /absolute/path/to/your.db:/data/shop.db:ro \
  -e DB_PATH=/data/shop.db \
  sqlite-mcp-server
```

**Windows (PowerShell):**

```powershell
docker run -i --rm `
  -v C:\Users\Ivan\data\shop.db:/data/shop.db:ro `
  -e DB_PATH=/data/shop.db `
  sqlite-mcp-server
```

**Windows (cmd.exe):**

```bat
docker run -i --rm ^
  -v C:\Users\Ivan\data\shop.db:/data/shop.db:ro ^
  -e DB_PATH=/data/shop.db ^
  sqlite-mcp-server
```

Обратите внимание: слева от двоеточия — путь в стиле хоста (в Windows с
обратными слэшами и буквой диска), справа — всегда путь Linux-контейнера.
В Windows папка с БД должна быть доступна Docker Desktop: *Settings → Resources
→ File sharing* (при WSL 2-бэкенде обычно доступны все диски по умолчанию).
Если в пути есть пробелы — возьмите **весь** аргумент `-v` в кавычки:
`-v "C:\My Data\shop.db:/data/shop.db:ro"`.

### Подключение к агенту через Docker

Вместо `node dist/index.js` хосту указывается команда `docker run ...`.

**Claude Code (macOS / Linux):**

```bash
claude mcp add sqlite-db-docker -s local -- \
  docker run -i --rm \
    -v /absolute/path/to/your.db:/data/shop.db:ro \
    -e DB_PATH=/data/shop.db \
    sqlite-mcp-server
```

**Claude Code (Windows PowerShell):**

```powershell
claude mcp add sqlite-db-docker -s local -- `
  docker run -i --rm `
    -v C:\Users\Ivan\data\shop.db:/data/shop.db:ro `
    -e DB_PATH=/data/shop.db `
    sqlite-mcp-server
```

**Claude Desktop и другие хосты** — в `claude_desktop_config.json`
(пути к файлу см. в разделе [Connect to agent](#claude-desktop-и-другие-mcp-хосты)):

```json
{
  "mcpServers": {
    "sqlite-db-docker": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/absolute/path/to/your.db:/data/shop.db:ro",
        "-e", "DB_PATH=/data/shop.db",
        "sqlite-mcp-server"
      ]
    }
  }
}
```

В Windows тот же конфиг, но в аргументе `-v` слэши экранируются по правилам JSON:
`"C:\\Users\\Ivan\\data\\shop.db:/data/shop.db:ro"`. Docker Desktop должен быть
запущен, иначе хост не сможет стартовать сервер.

### Если контейнер не работает

| Симптом | Причина и что делать |
|---|---|
| `Could not open database at "/data/shop.db"` | БД не примонтирована: проверьте левую часть `-v` (путь на хосте) и что файл существует |
| В Windows: `invalid mode` / `is not a valid Windows path` | Перепутаны стороны `-v` либо не хватает кавычек вокруг пути с пробелами |
| Хост «видит» сервер, но вызовы падают | Скорее всего добавлен `-t`: он ломает stdio-протокол. Нужен только `-i` |
| `Cannot connect to the Docker daemon` | Не запущен Docker Desktop (Windows/macOS) или служба `docker` (Linux) |
