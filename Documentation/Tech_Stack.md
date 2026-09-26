# Especificação da Stack Tecnológica e Infraestrutura Docker (TableEngine)

Este documento oficializa as tecnologias adotadas no **TableEngine**, detalha a arquitetura de execução dos serviços e fornece a especificação completa do `docker-compose.yml` para execução imediata sem necessidade de configurações manuais adicionais.

---

## 1. Visão Geral da Stack Tecnológica

| Camada | Tecnologia | Justificativa Técnica |
| :--- | :--- | :--- |
| **Banco de Dados** | **PostgreSQL 16** (com `pgcrypto`) | Suporte nativo a extensões UUID, transações ACID robustas, CTEs recursivas de alta performance e isolamento de variáveis de sessão via `set_config`. |
| **Backend** | **Golang (Go 1.22+)** | Linguagem compilada de altíssima performance e baixo consumo de memória, com concorrência nativa (goroutines), tipagem forte e driver `pgx/v5` otimizado para pooling transacional. |
| **Frontend** | **Next.js 14+ (App Router)** | Framework moderno em React com TypeScript, renderização otimizada, Tailwind CSS para design rico e responsivo, e arquitetura de componentes escalável para telas dinâmicas e FSM. |
| **Orquestração** | **Docker & Docker Compose** | Ambientes padronizados, inicialização com um comando e variáveis de ambiente com defaults prontos para produção local. |

---

## 2. Estrutura de Diretórios da Solução

```
TableEngine/
├── docker-compose.yml          # Orquestração local completa (Zero Setup)
├── Documentation/              # Especificações arquiteturais formais
│   ├── Documentation.pdf
│   ├── Endpoints.md
│   ├── Autenticacao_Credenciais_Sessao.md
│   ├── Regras_de_Negocio.md
│   ├── Tabelas_Colunas_e_Views_Polimorficas.md
│   ├── Condition_Tree.md
│   ├── State_Transitions.md
│   ├── Herancas_TPT.md
│   ├── Usuario_Roles_Grupos_Permissions.md
│   └── Tech_Stack.md
├── Backend/                    # Serviço Golang
│   ├── cmd/
│   │   └── api/
│   │       └── main.go         # Entrypoint da API REST
│   ├── internal/
│   │   ├── auth/               # JWT, credenciais e injeção de app.user_id
│   │   ├── ddl/                # Engine de criação de tabelas, campos e views
│   │   ├── crud/               # CRUD polimórfico multi-tabela TPT
│   │   ├── fsm/                # Validação de transições e UI Actions
│   │   ├── rules/              # Engine de Business Rules (sys_script)
│   │   ├── audit/              # Trilha de auditoria (sys_audit)
│   │   └── database/           # Pool pgx, migração inicial de Kernel e seed
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile              # Multi-stage build Go
└── Frontend/                   # Aplicação Next.js (TypeScript)
    ├── src/
    │   ├── app/                # Rotas do App Router
    │   ├── components/         # Componentes dinâmicos (Schema Studio, Record Studio)
    │   └── lib/                # Clientes de API e utilitários
    ├── package.json
    ├── tailwind.config.js
    └── Dockerfile              # Multi-stage build Node/Next.js
```

---

## 3. Especificação do `docker-compose.yml` (Zero Configuração Extra)

O arquivo `docker-compose.yml` na raiz do repositório é projetado para subir todo o ambiente de forma 100% autônoma com defaults seguros pré-definidos:

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: tableengine_db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-table_engine}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      PGDATA: /var/lib/postgresql/data/pgdata
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d table_engine"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./Backend
      dockerfile: Dockerfile
    container_name: tableengine_backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PORT: ${BACKEND_PORT:-8080}
      DATABASE_URL: ${DATABASE_URL:-postgres://postgres:postgres@db:5432/table_engine?sslmode=disable}
      JWT_SECRET: ${JWT_SECRET:-table_engine_ultra_secure_default_secret_key_32_bytes}
      INITIAL_ADMIN_USER: ${INITIAL_ADMIN_USER:-admin}
      INITIAL_ADMIN_PASSWORD: ${INITIAL_ADMIN_PASSWORD:-Admin123!Safe}
    ports:
      - "${BACKEND_PORT:-8080}:8080"

  frontend:
    build:
      context: ./Frontend
      dockerfile: Dockerfile
    container_name: tableengine_frontend
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      PORT: ${FRONTEND_PORT:-3000}
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8080/api/v1}
    ports:
      - "${FRONTEND_PORT:-3000}:3000"

volumes:
  postgres_data:
```

---

## 4. Tabela de Variáveis de Ambiente e Defaults

Todas as variáveis possuem valores padrão inteligentes prontos para execução direta:

| Variável de Ambiente | Serviço | Default Automático | Descrição |
| :--- | :--- | :--- | :--- |
| `POSTGRES_DB` | `db` | `table_engine` | Nome do banco de dados no PostgreSQL |
| `POSTGRES_USER` | `db` | `postgres` | Usuário administrador do banco |
| `POSTGRES_PASSWORD` | `db` | `postgres` | Senha do banco de dados |
| `DB_PORT` | `db` | `5432` | Porta mapeada no host |
| `PORT` | `backend` | `8080` | Porta interna do servidor Go |
| `BACKEND_PORT` | `backend` | `8080` | Porta mapeada do backend no host |
| `DATABASE_URL` | `backend` | `postgres://postgres:postgres@db:5432/table_engine?sslmode=disable` | String de conexão com o PostgreSQL |
| `JWT_SECRET` | `backend` | `table_engine_ultra_secure_default_secret_key_32_bytes` | Chave de assinatura dos tokens JWT |
| `INITIAL_ADMIN_USER` | `backend` | `admin` | Login do administrador criado no bootstrap |
| `INITIAL_ADMIN_PASSWORD` | `backend` | `Admin123!Safe` | Senha inicial do administrador |
| `FRONTEND_PORT` | `frontend` | `3000` | Porta mapeada da aplicação Next.js |
| `NEXT_PUBLIC_API_URL` | `frontend` | `http://localhost:8080/api/v1` | URL base da API consumida pelo navegador |

---

## 5. Instruções de Inicialização

1. **Subir todo o ambiente com compilação:**
   ```bash
   docker compose up --build
   ```
2. **Acessar a Aplicação:**
   * **Frontend Web (Next.js):** [http://localhost:3000](http://localhost:3000)
   * **Backend API REST (Golang):** [http://localhost:8080/api/v1](http://localhost:8080/api/v1)
3. **Credenciais Iniciais do Administrador:**
   * **Usuário:** `admin`
   * **Senha:** `Admin123!Safe`
