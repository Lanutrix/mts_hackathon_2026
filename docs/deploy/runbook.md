# Развёртывание и обновление

Системная установка выполнена, опубликован 166d769. Выполнять только на подтверждённом сервере из preflight. Пароли вводятся в собственном интерактивном SSH-терминале; никаких sshpass, паролей в argv, env, логах или истории команд.

1. Войти root с проверенным known_hosts и скопировать `bootstrap-root.sh` в новый каталог под /root с режимом 0700, сверить SHA-256 этой копии с доверенным локальным файлом и только затем запустить её. Он проверяет hostname/deploy key, сохраняет SSH/fstab backup, устанавливает PostgreSQL, закреплённые Node 24.18.0 и Caddy 2.11.9 с SHA256, создаёт swap только при его отсутствии, systemd sandbox и точечные sudoers для управления только mts-watermelon.service. Скрипт предназначен для первоначального пустого VDS, не для повторного запуска поверх произвольной конфигурации.
2. Проверить BOOTSTRAP_OK, независимый deploy-вход, `sudo -l`, peer-доступ `psql -d watermelon -c 'select 1'`, service unit, localhost bind и UFW. Не отключать root/password до подтверждённой recovery-консоли и замены раскрытого пароля.
3. Локально на проверенном commit: `npm ci --ignore-scripts`, `npm run build`, полный набор проверок. `git archive --format=tar HEAD -o release.tar`, затем добавить `dist/web` через `tar -rf release.tar dist/web`. SHA release.tar записать отдельно; не включать .runtime, users, .env, original или SSH keys. Передать через scp с проверкой host key, сверить SHA256 на сервере.
4. От deploy: `bash release.sh COMMIT_SHA /path/release.tar`. Создаёт новый каталог releases/SHA, `npm ci --omit=dev --ignore-scripts`, изолированный staging на 127.0.0.1:3001 с собственной синтетикой/PGlite; не запускает второго writer над production DB. Проверяет ready и четыре группы. Перед активацией проверить browser/AI через SSH-туннель на работающем приватном экземпляре. Результаты предварительной репетиции опубликованы в docs/qa/evidence/vds-staging.json. Node setup не требует Docker socket или группы docker.
5. В защищённом терминале создать серверного оператора `npm run user -- operator demo-admin /srv/mts-watermelon/shared/users.json`; пароль не отображается. Пользователи хранят salted scrypt hash. Перезапустить app после изменения. Не использовать HTTP IP preview для аутентификации.
6. Проверить backup restore в отдельной PostgreSQL БД по отдельному runbook. Затем `bash activate.sh COMMIT_SHA`: stop app → dump и source checkpoint → atomic current symlink → start → ready. При неуспешном ready автоматически выбирается previous app; additive schema не откатывается.
7. До DNS используется read-only HTTP preview на IP с запретом POST на proxy. После подтверждённой A/AAAA/CAA установить проверенный [Caddyfile](../../deploy/Caddyfile) для домена в конфигурацию отдельной службы watermelon-caddy. На изначально пустом VDS его можно использовать вместо временного IP preview. Проверить `caddy validate`, затем reload. Автоматический HTTPS и HTTP redirect — Caddy. Сертификаты сохраняются в /var/lib/caddy, admin API localhost. [Официальная документация](https://caddyserver.com/docs/automatic-https).
8. Проверить внешние DNS/TLS/redirect, страницу, два browser contexts, реальную запись файла, SSE reconnect, auth, AI и отсутствие открытого PostgreSQL/admin. Ни один HTTP 200 не заменяет эти проверки.

Сервис работает как deploy, HOST=127.0.0.1, MemoryHigh=600M/MemoryMax=750M, NoNewPrivileges/PrivateTmp/ProtectSystem. На VM 889 MiB модель может оказаться медленной или получить OOM: требуются реальные серверные measurements; fallback не выдаётся за AI pass. Журналы не содержат payload/cookies и ограничены journald; отдельный log retention администратора нужно подтвердить при установке.

Служебный порт 10050 существовал до задачи: скрипт сохраняет доступ, а ограничение доверенным адресом провайдера остаётся отдельным пунктом после получения диапазона. Новые публичные backend/DB порты не открываются.

## Вход по QR-ссылке

Команда выпускает один многоразовый URL для существующей учётной записи. Укажите настройки приложения `DATA_DIR`, `USERS_FILE` и `ORIGIN`. На VDS запустите команду от `deploy` из каталога релиза с Node из `/opt/watermelon-node/bin`.

```sh
DATA_DIR=/srv/mts-watermelon/shared \
USERS_FILE=/srv/mts-watermelon/shared/users.json \
ORIGIN=https://mts-watermelon.ru \
npm run --silent qr-login -- qr-guest 60
```

Команда сохраняет хэш кода в `DATA_DIR/secrets/qr-login.json` и выводит URL для QR-кода. Срок указывается в минутах от 1 до 480, по умолчанию 60. Перезапустите сервис, чтобы он загрузил конфигурацию. При выпуске новой ссылки файл заменяется. Чтобы отключить вход по QR, уберите файл из каталога `secrets` и перезапустите сервис.

При сканировании браузер открывает главную страницу с сеансом указанной учётной записи. Каждый сеанс действует до восьми часов или до истечения ссылки, если это произойдёт раньше. QR-код даёт права этой учётной записи каждому, кто его отсканирует.

Релиз может содержать временный хэш QR-кода для `https://mts-watermelon.ru` в `data/production-qr-login.json`. Он применяется только на этом проде до указанного срока. Для отключения хэша до истечения срока задайте `QR_LOGIN_RELEASE=false` и перезапустите сервис. Действующий QR из серверной конфигурации для другой учётной записи сохраняет приоритет.
