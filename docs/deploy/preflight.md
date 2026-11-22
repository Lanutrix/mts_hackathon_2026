# VDS preflight

Цель 89.19.215.254 / ams-1-vm-5409 подтверждена пользователем. ED25519 fingerprint: SHA256:Zi03RWwXLkEdlX1IC7q62gk+ee+fZ0TnwWjZ7SBYHKs. Все SSH/scp используют StrictHostKeyChecking=yes и отдельный known_hosts. Проверка host key не отключалась.

Фактическая исходная среда: Ubuntu 26.04.1; Linux 7.0.0-43; 1 CPU, 889 MiB RAM, около 12 GB свободно, swap отсутствовал. Порты 80/443 свободны. Существующий SSH 22 и provider Zabbix 10050 сохранены. PostgreSQL/Caddy/Node runtime отсутствовали. UFW был неактивен. Чужие приложения не обнаружены и не удалялись.

Пользователь deploy создан, отдельный ключ установлен, вход проверен во второй независимой сессии. Ключ хранится вне репозитория с ограниченным ACL. Директория /srv/mts-watermelon доступна deploy. Root используется только для первоначальной настройки. Root/password SSH policy не менялась: замена ранее раскрытого пароля и доступность recovery-консоли ещё не подтверждены.

`deploy/bootstrap-root.sh` загружен в /srv/mts-watermelon/bootstrap. Его выполнение не подтверждено: интерактивный root-вход завершился без результата BOOTSTRAP_OK; проверка от deploy не обнаружила /opt/watermelon-node, app unit и psql. Установка, firewall и proxy не объявляются выполненными.

Финальные четыре deployment-скрипта загружены в /srv/mts-watermelon/bootstrap; удалённый `bash -n` для каждого вернул BASH_SYNTAX_OK. Это синтаксическая проверка, не запуск установки.

Обновление 21.11.2026. В закрытом каталоге deploy развёрнуты Node 24.18 и PostgreSQL 18.6. Временная БД использовала Unix socket, приложение слушало loopback. Этот этап предшествовал системной установке. [Наблюдения и результаты](../qa/evidence/vds-staging.json).

После защищённого входа root установлены и включены PostgreSQL 18.6, Caddy 2.11.9 и служба приложения на Node 24.18. Сервис запущен под deploy, сертификат проверен извне. [Публичная проверка](../qa/evidence/public-release.json).
