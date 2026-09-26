# Arquitetura de Autenticação, Credenciais e Sessão (TableEngine)

Este documento especifica formalmente a modelagem de identidade, segurança de credenciais, ciclo de vida de sessão e o mecanismo de propagação transacional de identidade para o PostgreSQL no **TableEngine**.

---

## 1. Princípios Fundamentais de Identidade

1. **Identidade Canônica (`sys_user`):**
   * A entidade `sys_user` é o único registro canônico de pessoas e contas de serviço que operam na plataforma.
   * Toda chave técnica no banco de dados é um **UUID v4** imutável (`sys_id`).
   * **Proibição Estrita:** Atributos textuais como `user_name` e `email` são usados apenas para autenticação e exibição na UI; eles **nunca** são utilizados como chave primária ou chave estrangeira em nenhuma tabela ou registro de auditoria.

2. **Isolamento de Credenciais:**
   * A tabela `sys_user` **não armazena segredos de autenticação** (como hashes de senhas ou tokens). Isso impede que dados confidenciais sejam expostos em consultas acidentais de perfil ou registrados pela trigger de auditoria `sys_audit`.

---

## 2. Modelagem da Tabela de Credenciais (`sys_user_credential`)

Para manter conformidade estrita com o princípio do menor privilégio e garantir que segredos nunca entrem na trilha de auditoria universal, as credenciais são armazenadas em uma estrutura isolada no banco:

```sql
CREATE TABLE sys_user_credential (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES sys_user(sys_id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    algorithm VARCHAR(32) NOT NULL DEFAULT 'argon2id',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    password_updated_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_user_credential_lookup ON sys_user_credential(user_id);
```

### Regras de Segurança:
* **Algoritmo de Hash:** Suporte padrão a **Argon2id** (ou alternativamente **bcrypt** com custo $\ge 12$).
* **Proteção contra Força Bruta:** Após 5 tentativas consecutivas incorretas, a conta tem `locked_until` preenchido por 15 minutos.
* **Isolamento de Auditoria:** A tabela `sys_user_credential` **nunca** recebe a trigger de auditoria `trg_generic_audit_diff`.

---

## 3. Transporte de Sessão e Emissão de Tokens (JWT)

A plataforma opera com sessão sem estado (stateless) entre o cliente HTTP e o backend em Golang, garantindo escalabilidade horizontal:

### 3.1 Formato do Token JWT
* **Algoritmo de Assinatura:** `HMAC-SHA256` (HS256) utilizando a variável de ambiente `JWT_SECRET`.
* **Tempo de Expiração Padrão:** 8 horas.
* **Claims do Payload JWT:**
  ```json
  {
    "sub": "00000000-0000-4000-8000-000000000003",
    "user_name": "carlos.silva",
    "iss": "tableengine-api",
    "iat": 1790424000,
    "exp": 1790452800
  }
  ```
  *(Nota: As roles e permissões **não** são gravadas no token para permitir revogação e modificação imediata no banco de dados).*

### 3.2 Cabeçalho de Transporte
Todas as requisições autenticadas devem enviar:
```http
Authorization: Bearer <TOKEN_JWT>
```

---

## 4. Injeção Transacional no PostgreSQL (`app.user_id`)

Para viabilizar a auditoria universal em `sys_audit`, a execução de funções de numeração (`sys_next_number`) e o preenchimento automático das colunas `sys_created_by` e `sys_updated_by`, a identidade do usuário autenticado é propagada diretamente para a transação do PostgreSQL.

### 4.1 Ciclo de Execução no Backend (Golang)
Em qualquer requisição que realize operações no banco de dados:

1. O middleware de autenticação valida o JWT e extrai o `sys_user.sys_id` (`sub`).
2. O handler abre uma transação SQL atômica no pool de conexões:
   ```go
   tx, err := db.Begin(ctx)
   ```
3. O backend executa imediatamente o comando `set_config`:
   ```sql
   SELECT set_config('app.user_id', $1, true);
   ```
   * **Importante:** O terceiro parâmetro `true` (`is_local = true`) restringe a variável `app.user_id` **exclusivamente à transação em andamento**. Quando a conexão retorna ao pool do Go (`pgx`), a variável é resetada automaticamente, evitando vazamento de identidade entre requisições concorrentes.
4. Qualquer `INSERT`, `UPDATE` ou `DELETE` disparará a trigger `trg_generic_audit_diff()`, que captura o autor através de:
   ```sql
   actor UUID := NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
   ```
5. A transação é finalizada com `COMMIT;` ou `ROLLBACK;`.

---

## 5. Resolução Dinâmica de Autorização em Tempo Real (Zero Cache)

Seguindo a premissa de arquitetura da versão 2: **não há cache de autorização nesta fase**. O backend em Go avalia o grafo de permissões diretamente no PostgreSQL em cada operação:

```
[sys_user] (sys_id, is_active = true)
    │
    ▼ 1..N (sys_user_grmember)
[sys_user_group] (is_active = true)
    │
    ▼ 1..N (sys_group_has_role)
[sys_user_role] (is_active = true)
    │
    ▼ 1..N (sys_role_has_permission)
[sys_permission] (is_active = true, table_id, operation, field_name, condition_tree)
```

### Regras de Avaliação:
* **Usuário Inativo:** Se `sys_user.is_active = false`, a requisição é rejeitada imediatamente com `401 Unauthorized`.
* **Grupos Inativos:** Se um grupo for desativado, suas roles deixam de ser herdadas em tempo real.
* **Combinação de Permissões:**
  * Permissões no mesmo nível hierárquico combinam-se por **OR**.
  * Validações de tabela/registro e validações de campo combinam-se por **AND**.
  * A ausência de uma regra explícita de campo adota a regra geral de tabela/registro.
  * Nenhuma permissão de usuário pode sobrescrever campos `is_read_only = true` definidos estruturalmente no dicionário.

---

## 6. Contas de Serviço e Usuários do Sistema

1. **Conta Técnica do Kernel (`system_service`):**
   * `sys_id`: `00000000-0000-0000-0000-000000000001`
   * `user_name`: `system_service`
   * `is_service_account`: `true`
   * Utilizada durante o bootstrap de inicialização e em rotinas automáticas de backend. Não possui login interativo por senha.
2. **Administrador Inicial (`admin`):**
   * `sys_id`: `00000000-0000-4000-8000-000000000002`
   * `user_name`: `admin`
   * `is_service_account`: `false`
   * Pertence ao grupo `System Administrators` que possui a role `admin` com concessão de todas as permissões (`create`, `read`, `update`, `delete`, `execute`) em todas as tabelas `sys_*` e `tbl_*`.
