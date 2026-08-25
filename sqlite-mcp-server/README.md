# sqlite-mcp-server

Read-only MCP-сервер для SQLite. Работает по stdio, использует
`@modelcontextprotocol/sdk` и `better-sqlite3`. Инструменты:

- `list_tables`, `describe_table`, `run_query` — общего назначения (только
  `SELECT`/`WITH ... SELECT`, с пагинацией и понятными ошибками — подробности
  и обоснование read-only-гарантий в [SPEC.md](./SPEC.md));
- `top_customers_by_spend`, `top_selling_products`, `revenue_by_category`,
  `customers_by_order_count` — специализированные tools под частые вопросы
  аналитики магазина, чтобы агенту не приходилось каждый раз писать JOIN руками.

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

## Tests

Автотесты (`node --test`, встроенный test runner, без доп. фреймворка)
поднимают собранный сервер (`dist/index.js`) как реальный MCP stdio-процесс
через `@modelcontextprotocol/sdk`-клиент и гоняют его против детерминированной
фикстур-базы (`tests/fixture.ts` — не связана с `sqlitedb/shop.db`, так что
тесты не зависят от возможной пересборки/реseed'а демо-данных).

```bash
npm test
```

`pretest` сам сделает `npm run build`. Покрытие (41 тест):

| Файл | Что проверяет |
|---|---|
| `tests/schema.test.ts` | `list_tables`/`describe_table`, наличие `title`/description у каждого tool'а, аннотация `readOnlyHint: true`, перекрёстные ссылки между описаниями |
| `tests/read-only.test.ts` | Отказ на `INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/PRAGMA/REPLACE INTO`, обход через CTE и через `;`-склейку, отсутствие write-tool'ов, реальное отсутствие мутаций в БД |
| `tests/pagination.test.ts` | Постраничная выдача `run_query` (`limit`/`offset`/`hasMore`/`nextOffset`), сохранение `ORDER BY` между страницами, жёсткий потолок `limit=200`, запрет на собственный `LIMIT` в запросе |
| `tests/errors.test.ts` | Понятные сообщения на `no such table`/`no such column`/синтаксическую ошибку, отсутствие stack trace в любом ответе tool'а |
| `tests/specialized-tools.test.ts` | Корректность агрегаций всех четырёх специализированных tools, поведение `excludeCancelled`, деградация на БД без нужных таблиц |
| `tests/startup.test.ts` | Чистый (без stack trace) отказ процесса при отсутствующем/невалидном `DB_PATH` |

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

Проверено вживую (`docker.io` 29.1.3, Ubuntu 24.04): `docker build` собирает образ
(338MB) без ошибок, а полный MCP-протокол (`initialize` → `tools/list` →
`run_query`/`top_customers_by_spend` → отказ на `DELETE`/`PRAGMA`) через
`docker run -i` с `shop.db`, примонтированной как `:ro`, отработал идентично
запуску вне контейнера.
