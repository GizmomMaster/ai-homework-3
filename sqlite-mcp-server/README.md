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

## Install

Проект на Node.js/TypeScript — зависимости описаны в `package.json` /
`package-lock.json` (это источник истины для `npm`); `requirements.txt` в
корне проекта — их текстовое зеркало для чек-листов, ожидающих такой файл.

```bash
npm install
```

## Configure

Серверу нужен путь к файлу SQLite. Передайте его одним из двух способов:

- переменной окружения `DB_PATH`;
- первым позиционным аргументом при запуске.

Пример конфигурации — в [`.env.example`](./.env.example). Сервер не грузит
`.env` автоматически (нет зависимости `dotenv`), поэтому переменные нужно
экспортировать в окружение перед запуском:

```bash
cp .env.example .env
set -a; source .env; set +a
```

Либо задать вручную:

```bash
export DB_PATH=/absolute/or/relative/path/to/your.db
```

Относительный путь резолвится от корня этого проекта (папки, где лежит
`package.json`), а не от текущей директории, из которой запущена команда.

Путь к БД нигде не захардкожен в исходном коде — если `DB_PATH` не задан,
процесс завершится с понятной ошибкой и не запустится.

## Run

```bash
npm run build   # компиляция TypeScript -> dist/
npm start       # запуск dist/index.js (использует DB_PATH из окружения)
```

Либо для разработки без сборки:

```bash
npm run dev     # tsx src/index.ts
```

Сервер общается по stdio и ничего не печатает в stdout, кроме
JSON-RPC-сообщений протокола MCP — это нормально, отдельного "он запустился"
сообщения не будет. Ошибки конфигурации (например, неверный `DB_PATH`)
печатаются в stderr, и процесс завершается с кодом 1.

## Connect to agent

### Claude Code (CLI)

```bash
claude mcp add sqlite-db -s local \
  -e DB_PATH=/absolute/path/to/your.db \
  -- node /absolute/path/to/sqlite-mcp-server/dist/index.js
```

- `-s local` — конфиг виден только вам в текущем проекте (не коммитится в git).
  Для командного `.mcp.json` (`-s project`) `DB_PATH` всё равно должен
  задаваться каждым разработчиком отдельно — абсолютный путь к локальному
  файлу БД непереносим между машинами.

Проверить подключение:

```bash
claude mcp get sqlite-db
```

Ожидаемый статус — `✔ Connected`.

### Любой другой MCP-хост (Claude Desktop и т.п.)

Добавьте stdio-сервер в конфиг хоста:

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

После перезапуска хоста агенту станут доступны все инструменты сервера.

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

```bash
docker build -t sqlite-mcp-server .
```

Сервер общается по stdio, поэтому контейнер нужно запускать в интерактивном
режиме (`-i`, без `-t`) и примонтировать файл БД как volume:

```bash
docker run -i --rm \
  -v /absolute/path/to/your.db:/data/shop.db:ro \
  -e DB_PATH=/data/shop.db \
  sqlite-mcp-server
```

Подключение из Claude Code — вместо `node dist/index.js` в качестве команды
указывается `docker run ...`:

```bash
claude mcp add sqlite-db-docker -s local -- \
  docker run -i --rm \
    -v /absolute/path/to/your.db:/data/shop.db:ro \
    -e DB_PATH=/data/shop.db \
    sqlite-mcp-server
```
