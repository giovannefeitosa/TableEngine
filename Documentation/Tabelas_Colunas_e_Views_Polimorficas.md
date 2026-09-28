# Catálogo de Tabelas, Colunas e Views Polimórficas (TableEngine)

Este documento centraliza todas as especificações das tabelas do Kernel, o contrato estrutural de tabelas de negócio (raiz e derivadas), o mapeamento formal de tipos de dados e a geração automatizada de views polimórficas no PostgreSQL.

---

## 1. Convenção de Nomenclatura e Namespaces

| Tipo de Estrutura | Prefixo Obrigatório | Exemplo | Finalidade |
| :--- | :--- | :--- | :--- |
| **Tabelas do Kernel** | `sys_` | `sys_db_object`, `sys_user` | Tabelas estruturais, de segurança e auditoria da engine. |
| **Tabelas de Negócio** | `tbl_` | `tbl_task`, `tbl_incident` | Tabelas físicas criadas dinamicamente via UI/API. Evita colisões com palavras reservadas ANSI SQL. |
| **Views Polimórficas** | `v_` | `v_incident`, `v_change_request` | Views geradas automaticamente para leitura consolidada e tipada de hierarquias TPT. |

---

## 2. Catálogo do Kernel de Metadados (Data Dictionary)

O banco de dados PostgreSQL inicializa exclusivamente com as estruturas do Kernel. Nenhuma tabela de domínio de negócio existe previamente.

### 2.1 Catálogo de Classes/Tabelas (`sys_db_object`)
Armazena o registro de todas as tabelas (sistema e negócio).
```sql
CREATE TABLE sys_db_object (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    super_class_id UUID REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    is_extendable BOOLEAN NOT NULL DEFAULT TRUE,
    is_kernel_table BOOLEAN NOT NULL DEFAULT FALSE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp()
);
```

### 2.2 Dicionário de Campos (`sys_dictionary`)
Armazena a definição de cada atributo de uma tabela.
```sql
CREATE TABLE sys_dictionary (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    column_name VARCHAR(80) NOT NULL,
    label VARCHAR(100) NOT NULL,
    internal_type VARCHAR(40) NOT NULL,
    max_length INTEGER DEFAULT 255,
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
    default_value TEXT,
    reference_table_id UUID REFERENCES sys_db_object(sys_id),
    is_system_field BOOLEAN NOT NULL DEFAULT FALSE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (table_id, column_name)
);
```

### 2.3 Lista de Opções (`sys_choice`)
Armazena opções para campos do tipo dropdown.
```sql
CREATE TABLE sys_choice (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    element VARCHAR(80) NOT NULL,
    value VARCHAR(100) NOT NULL,
    label VARCHAR(100) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    dependent_value VARCHAR(100),
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (table_id, element, value)
);
```

### 2.4 Numeração Automática (`sys_number` e `sys_number_counter`)
```sql
CREATE TABLE sys_number (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    field_name VARCHAR(80) NOT NULL DEFAULT 'number',
    prefix VARCHAR(3) NOT NULL UNIQUE,
    minimum_digits SMALLINT NOT NULL DEFAULT 7 CHECK (minimum_digits BETWEEN 1 AND 19),
    start_number BIGINT NOT NULL DEFAULT 1 CHECK (start_number >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (char_length(prefix) BETWEEN 1 AND 3 AND prefix = upper(btrim(prefix))),
    UNIQUE (table_id, field_name)
);

CREATE TABLE sys_number_counter (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number_id UUID NOT NULL UNIQUE REFERENCES sys_number(sys_id) ON DELETE RESTRICT,
    last_value BIGINT NOT NULL CHECK (last_value >= 0)
);
```

### 2.5 Trilha de Auditoria Universal (`sys_audit`)
```sql
CREATE TABLE sys_audit (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(80) NOT NULL,
    document_id UUID NOT NULL,
    operation VARCHAR(6) NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    field_name VARCHAR(80) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    changed_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT
);

CREATE INDEX idx_audit_doc ON sys_audit(table_name, document_id, changed_on);
```

### 2.6 Catálogo de Estados do Ciclo de Vida (`sys_state`)
Armazena a definição canônica de cada estado operacional da plataforma, com rótulos, sequência e cores:
```sql
CREATE TABLE sys_state (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    label VARCHAR(80) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    color VARCHAR(30) DEFAULT 'slate',
    description TEXT,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_state_name_table UNIQUE (table_id, name)
);

CREATE INDEX idx_state_lookup ON sys_state(name, table_id) WHERE is_active = TRUE;
```

---

## 3. Contrato da Tabela Raiz de Negócio (`super_class_id IS NULL`)

Toda tabela base criada pelo usuário recebe compulsoriamente os seguintes campos de Kernel:

```sql
CREATE TABLE tbl_<nome> (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sys_class_name VARCHAR(80) NOT NULL,
    sys_created_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    sys_created_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_on TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    sys_updated_by UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0
);
```

* `sys_class_name`: Discriminador polimórfico contendo o nome da tabela física concreta do registro (ex.: `'tbl_incident'`).
* `sys_mod_count`: Contador inteiro para controle de concorrência otimista (Optimistic Locking).

---

## 4. Contrato da Tabela Filha TPT (`super_class_id IS NOT NULL`)

Tabelas derivadas **não replicam** nenhuma das colunas de auditoria ou discriminador da tabela raiz:

```sql
CREATE TABLE tbl_<nome> (
    sys_id UUID PRIMARY KEY,
    -- Campos específicos adicionados à classe filha...
    CONSTRAINT fk_<nome>_parent_<parent_nome>
        FOREIGN KEY (sys_id) REFERENCES tbl_<parent_nome>(sys_id) ON DELETE CASCADE
);
```

* A coluna `sys_id` atua simultaneamente como **Chave Primária (PK)** e **Chave Estrangeira (FK)** apontando para o pai imediato com `ON DELETE CASCADE`.

---

## 5. Mapeamento Formal de Tipos (`internal_type` $\rightarrow$ DDL PostgreSQL)

Ao adicionar uma coluna através da API ou UI (`POST /api/v1/schema/tables/:id/fields`), o DDL Orchestrator mapeia o `internal_type` para a definição física exata no PostgreSQL:

| `internal_type` | Tipo Físico PostgreSQL | Modificadores e Constraints Padrão | Exemplo de Uso |
| :--- | :--- | :--- | :--- |
| `string` | `VARCHAR(max_length)` | Default `max_length = 255` | Nomes, títulos, códigos curtos |
| `text` | `TEXT` | Sem limite de tamanho | Descrição detalhada, notas de resolução |
| `integer` | `INTEGER` | 4 bytes | Severidade, prioridade, contadores inteiros |
| `bigint` | `BIGINT` | 8 bytes | Contadores grandes, métricas de hardware |
| `boolean` | `BOOLEAN` | `DEFAULT FALSE` | Flags (ex.: `active`, `vip_caller`) |
| `reference` | `UUID` | `REFERENCES <ref_table>(sys_id) ON DELETE RESTRICT` | Vínculos a outras entidades (ex.: `caller_id` -> `sys_user`, `state` -> `sys_state`) |
| `auto_number` | `VARCHAR(22)` | `NOT NULL UNIQUE` (gerado por `sys_next_number`) | Identificador amigável (ex.: `TSK0000001`) |
| `timestamptz` | `TIMESTAMPTZ` | Timestamp com timezone | Datas de vencimento, resolução, agendamentos |
| `jsonb` | `JSONB` | `DEFAULT '{}'::jsonb` | Metadados extras não estruturados |
| `uuid` | `UUID` | Chaves UUID avulsas | Identificadores externos |

> [!IMPORTANT]
> **Campo `state` da Tabela `tbl_task`:**
> A coluna `state` em `tbl_task` é implementada formalmente como `internal_type = 'reference'` com `reference_table_id` apontando para a tabela `sys_state`. No banco físico, seu tipo é `UUID REFERENCES sys_state(sys_id) ON DELETE RESTRICT`. A Máquina de Estados Finita (FSM) intercepta e controla rigorosamente qualquer coluna que possua esta referência a `sys_state`.

---

## 6. Geração e Propagação de Views Polimórficas (`v_<nome>`)

Para simplificar consultas no backend e na UI, cada tabela derivada possui uma view polimórfica gerada automaticamente que realiza os `JOINs` de toda a sua cadeia de herança.

### 6.1 Algoritmo de Geração
1. O backend resolve a linhagem ascendente da tabela concreta até a raiz via CTE recursiva:
   `tbl_security_incident` $\rightarrow$ `tbl_incident` $\rightarrow$ `tbl_task`.
2. Constrói o `JOIN` físico utilizando `sys_id`:
   ```sql
   CREATE OR REPLACE VIEW v_security_incident AS
   SELECT
       -- Campos da tabela raiz (tbl_task)
       t.sys_id,
       t.sys_class_name,
       t.number,
       t.short_description,
       t.state,
       t.sys_created_on,
       t.sys_created_by,
       t.sys_updated_on,
       t.sys_updated_by,
       t.sys_mod_count,
       -- Campos da tabela intermediária (tbl_incident)
       i.severity,
       i.caller_id,
       i.close_notes,
       -- Campos da tabela folha (tbl_security_incident)
       s.threat_level,
       s.cve_identifier
   FROM tbl_security_incident s
   JOIN tbl_incident i ON s.sys_id = i.sys_id
   JOIN tbl_task t ON i.sys_id = t.sys_id;
   ```

### 6.2 Propagação Automática em Alterações DDL
Quando uma coluna nova é adicionada a qualquer tabela da hierarquia (ex.: adicionou `priority` em `tbl_task`):
* O DDL Orchestrator executa `ALTER TABLE tbl_task ADD COLUMN priority INTEGER;`.
* Imediatamente busca todas as tabelas que herdam direta ou indiretamente de `tbl_task`.
* Regera atomicamente as views `v_incident`, `v_security_incident`, etc., garantindo que a nova coluna esteja disponível para leitura em todos os descendentes sem intervenção manual.

---

## 7. Função e Trigger de Auditoria em PL/pgSQL

Toda tabela criada no sistema recebe automaticamente a vinculação com a trigger universal:

```sql
CREATE OR REPLACE FUNCTION trg_generic_audit_diff()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    key_name TEXT;
    old_map JSONB := '{}'::JSONB;
    new_map JSONB := '{}'::JSONB;
    record_id UUID;
    actor UUID := NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM sys_user WHERE sys_id = actor AND is_active
    ) THEN
        RAISE EXCEPTION 'Auditoria requer sys_id de usuário ativo no contexto';
    END IF;

    IF TG_OP = 'INSERT' THEN
        new_map := to_jsonb(NEW);
        record_id := NEW.sys_id;
    ELSIF TG_OP = 'DELETE' THEN
        old_map := to_jsonb(OLD);
        record_id := OLD.sys_id;
    ELSE
        old_map := to_jsonb(OLD);
        new_map := to_jsonb(NEW);
        record_id := NEW.sys_id;
    END IF;

    FOR key_name IN SELECT jsonb_object_keys(old_map || new_map) LOOP
        IF key_name NOT IN ('sys_updated_on', 'sys_mod_count')
           AND (TG_OP <> 'UPDATE' 
                OR (old_map -> key_name) IS DISTINCT FROM (new_map -> key_name)) THEN
            INSERT INTO sys_audit (
                table_name, document_id, operation, field_name,
                old_value, new_value, changed_by
            ) VALUES (
                TG_TABLE_NAME, record_id, TG_OP, key_name,
                old_map -> key_name, new_map -> key_name, actor
            );
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
```

A vinculação para cada tabela física:
```sql
CREATE TRIGGER trg_audit_<nome_tabela>
AFTER INSERT OR UPDATE OR DELETE ON <nome_tabela>
FOR EACH ROW EXECUTE FUNCTION trg_generic_audit_diff();
```
*(Regra estrita: `sys_audit` e `sys_user_credential` **nunca** recebem esta trigger para evitar recursão infinita e vazamento de hashes).*
