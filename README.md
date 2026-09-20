# Masādir Desktop

Локальное desktop-приложение для полнотекстового поиска по библиотеке книг.

Статус: implementation bootstrap / development in progress.

Поддерживаемые цели MVP: macOS arm64 и Windows x64.

Стек: Electron + TypeScript + Recoll.

Каноническая документация: [docs/README.md](docs/README.md).

## Разработка

```sh
npm install
npm start
```

Основные проверки:

```sh
npm run test:unit
npm run typecheck
npm run lint
```

Локальные настройки, индекс и диагностика хранятся в каталоге
`<userData>/Masadir/` и не отправляются во внешние сервисы.
