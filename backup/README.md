# Database Backup & Restore

Este diretório contém o backup completo do banco de dados do **TableEngine** (`table_engine`), incluindo o schema DDL (tabelas de metadados do Kernel, tabelas de usuário, constraints, índices, triggers e funções) e todos os dados populados.

---

## 📁 Arquivos

- `table_engine_backup.sql`: Snapshot SQL gerado com `--clean --if-exists --no-owner --no-privileges`. Pode ser restaurado diretamente em instâncias locais ou Docker.
- `restore_db.ps1`: Script PowerShell para restaurar o banco de dados.
- `backup_db.ps1`: Script PowerShell para gerar um novo backup a qualquer momento.
- `restore_db.sh`: Script Bash para restaurar em ambientes Linux/macOS/Docker.
- `backup_db.sh`: Script Bash para gerar novo backup em Linux/macOS/Docker.

---

## 🚀 Como Restaurar

### Opção 1: PowerShell (Windows / Ambiente Local)
Execute o script `restore_db.ps1`:

```powershell
.\backup\restore_db.ps1
```

> **Nota**: O script detecta automaticamente a instalação do PostgreSQL local em `.pgsql\pgsql\bin\psql.exe` ou no `PATH`.  
> Você pode passar parâmetros customizados se necessário:
> ```powershell
> .\backup\restore_db.ps1 -DbHost localhost -DbPort 5432 -DbUser postgres -DbPassword postgres -DbName table_engine
> ```

---

### Opção 2: Docker Compose
Se estiver executando o banco via Docker (`docker-compose.yml`):

```bash
docker-compose exec -T db psql -U postgres -d table_engine < backup/table_engine_backup.sql
```

---

### Opção 3: Linha de comando `psql` direta
Se você tem o `psql` configurado:

```bash
psql -h localhost -p 5432 -U postgres -d table_engine -f backup/table_engine_backup.sql -v ON_ERROR_STOP=1
```

---

## 🔄 Como Gerar um Novo Backup

### Via PowerShell:
```powershell
.\backup\backup_db.ps1
```

### Via Docker Compose:
```bash
docker-compose exec -T db pg_dump -U postgres -d table_engine --clean --if-exists --no-owner --no-privileges > backup/table_engine_backup.sql
```
