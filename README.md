# Masādir Desktop

Локальное desktop-приложение для полнотекстового поиска по библиотеке книг.

Статус: development in progress; установочные сборки заблокированы до поставки
проверенных Recoll runtime для обеих платформ.

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

## Установочные сборки

Сборка выполняется на целевой OS и архитектуре. macOS arm64 создаёт DMG,
Windows x64 — Squirrel `Masadir-Setup.exe` и `.nupkg` (без MSI).
Код хранится в `app.asar`, а Recoll и helper-файлы — в
`resources/<platform-arch>/`. Приложение использует только bundled runtime.

Перед сборкой подготовьте отдельно для каждой платформы
`assets/runtime/darwin-arm64` или `assets/runtime/win32-x64`. Файл
`runtime-manifest.template.json` показывает формат; заполненный
`runtime-manifest.json` должен содержать настоящие версии Recoll и helpers,
`indexCompatibilityVersion`, пути всех необходимых для PDF/DOC/DOCX файлов,
SHA-256 каждого `requiredFiles`, а также `licenses` с точным именем, версией,
HTTPS-источником и путём к полному тексту лицензии внутри runtime. Все файлы,
включая динамические библиотеки, фильтры и лицензии, перечисляются в
`requiredFiles`; `helperVersions` содержит версии отдельных компонентов,
названия которых совпадают с их `licenses[].name`. Подготовка payload —
отдельный ручной шаг: скрипты ничего не скачивают и не берут Recoll из `PATH`.

```sh
npm ci
npm run verify:runtime -- darwin-arm64  # macOS arm64
npm run make:mac
npm run verify:package -- darwin-arm64
```

На Windows x64 используйте `win32-x64`, `make:win` и
`verify:package -- win32-x64`. Forge перед сборкой сам запускает
`verify-runtime`; `verify-package` проверяет установочный файл, собранное
приложение, ресурсы, версии и Electron fuses. После добавления настоящего
runtime выполните также `npm run test:recoll` на каждой целевой OS.

Без credentials создаётся только unsigned internal artifact. Для подписи
macOS можно задать `MASADIR_MAC_SIGN_IDENTITY`, а для notarization вместе
с ним — `MASADIR_NOTARY_KEYCHAIN_PROFILE` (профиль в Keychain). На Windows
задайте `MASADIR_WINDOWS_CERTIFICATE_FILE` и
`MASADIR_WINDOWS_CERTIFICATE_PASSWORD`. Секреты в репозиторий не помещаются.
`SOURCE_DATE_EPOCH` при необходимости фиксирует время в build manifest.
Пользовательские данные находятся вне каталога приложения и installer-managed
директорий; install/upgrade smoke проверяется отдельно.
