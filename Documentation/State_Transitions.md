# Especificação da Máquina de Estados e Ciclo de Vida Polimórfico (`State_Transitions`)

Este documento detalha o modelo da **Máquina de Estados Finita (FSM)** declarativa, orientada a metadados e polimórfica sobre a arquitetura TPT no **TableEngine**.

---

## 1. Visão Geral e Princípios Fundamentais

* **Estrita Vinculação ao Catálogo `sys_state`:** Toda definição de estado, rótulo humanizado (*label*), ordenação sequencial e estilização visual reside compulsoriamente na tabela `sys_state`. A FSM não opera com strings avulsas; ela governa de forma estrita e centralizada qualquer coluna do banco que seja uma referência (`internal_type = 'reference'`) para `sys_state`.
* **Governança do Campo `state` em `tbl_task`:** A coluna física `state` da tabela base `tbl_task` é categorizada formalmente no dicionário de dados (`sys_dictionary`) como uma referência (`reference`) apontando para `sys_state(sys_id)`. Seus valores em banco são UUIDs imutáveis dos estados homologados.
* **Detecção Dinâmica de Referências:** Durante operações de CRUD (Create/Update), a engine inspeciona recursivamente a linhagem da tabela em `sys_dictionary`. Qualquer atributo que aponte para `sys_state` é automaticamente submetido às travas, validações de transição e guardas da FSM.
* **Polimorfismo com Precedência:** Tabelas filhas herdam os campos de estado e as transições de sua classe pai, mas podem sobrescrever transições específicas ou cadastrar novos fluxos de ciclo de vida mantendo a mesma referência a `sys_state`.
* **Autorização em Camadas:** Para executar uma transição de estado, o usuário deve possuir:
  1. Permissão geral de `update` sobre o registro.
  2. Permissão de `execute` sobre a ação `transition:<from_state_name>:<to_state_name>` ou permissão administrativa.
  3. A role específica exigida em `required_role_id` (se configurada na transição).
  4. Satisfação integral das regras declarativas de negócio em `condition_tree` (AST).

---

## 2. Catálogo Central de Estados (`sys_state`)

A tabela `sys_state` é a fonte canônica de todos os status da plataforma. Ela armazena os rótulos de exibição, sequência visual, cores de badge na interface e permite escopo global (`table_id IS NULL`) ou especializado por tabela.

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

### 2.1 Estados Padrão do Sistema (Deterministic UUIDs)

Durante o bootstrap do Kernel, os seguintes estados fundamentais são provisionados deterministicamente:

| UUID Canônico | Nome Técnico (`name`) | Rótulo Oficial (`label`) | Sequência | Cor / Badge | Finalidade |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `30000000-0000-0000-0000-000000000001` | `draft` | Rascunho | 10 | `slate` | Registro recém-iniciado em preparação |
| `30000000-0000-0000-0000-000000000002` | `new` | Novo | 20 | `blue` | Registro submetido e aguardando triagem |
| `30000000-0000-0000-0000-000000000003` | `in_progress` | Em Andamento | 30 | `amber` | Em atendimento ativo pela equipe responsável |
| `30000000-0000-0000-0000-000000000004` | `resolved` | Resolvido | 40 | `emerald` | Solução aplicada aguardando homologação |
| `30000000-0000-0000-0000-000000000005` | `closed` | Fechado | 50 | `purple` | Ciclo concluído definitivamente |
| `30000000-0000-0000-0000-000000000006` | `canceled` | Cancelado | 60 | `rose` | Descontinuado ou descartado |

---

## 3. Catálogo de Transições (`sys_state_transition`)

As transições de ciclo de vida conectam estritamente chaves estrangeiras de `sys_state`:

```sql
CREATE TABLE sys_state_transition (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    state_field VARCHAR(80) NOT NULL DEFAULT 'state',
    from_state_id UUID NOT NULL REFERENCES sys_state(sys_id) ON DELETE CASCADE,
    to_state_id UUID NOT NULL REFERENCES sys_state(sys_id) ON DELETE CASCADE,
    from_state VARCHAR(50),
    to_state VARCHAR(50),
    label VARCHAR(80) NOT NULL,
    required_role_id UUID REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    condition_tree JSONB,
    on_transition_action JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_state_transition_ids UNIQUE (table_id, state_field, from_state_id, to_state_id)
);

CREATE INDEX idx_transition_ids_lookup
ON sys_state_transition(table_id, state_field, from_state_id, to_state_id)
WHERE is_active = TRUE;
```

* `from_state_id`: FK obrigatória apontando para o status de origem em `sys_state`.
* `to_state_id`: FK obrigatória apontando para o status de destino em `sys_state`.
* `from_state` e `to_state`: Armazenam os nomes técnicos sincronizados para fins de indexação e consultas rápidas.
* `label`: Texto exibido no botão da UI (ex.: *"Iniciar Atendimento"* ou *"Resolver Chamado"*).

---

## 4. Modelagem da Coluna `state` em `tbl_task` e Linhagem TPT

A coluna `state` é definida fisicamente no PostgreSQL e catalogada no dicionário com integridade referencial:

### 4.1 Definição Física na Tabela Raiz
```sql
ALTER TABLE tbl_task
    ALTER COLUMN state TYPE UUID USING state::UUID,
    ALTER COLUMN state SET DEFAULT '30000000-0000-0000-0000-000000000002'::UUID,
    ADD CONSTRAINT fk_task_state_sys_state FOREIGN KEY (state) REFERENCES sys_state(sys_id) ON DELETE RESTRICT;
```

### 4.2 Registro em `sys_dictionary`
```sql
INSERT INTO sys_dictionary (
    table_id, column_name, label, internal_type, reference_table_id, is_mandatory, default_value
) VALUES (
    (SELECT sys_id FROM sys_db_object WHERE name = 'tbl_task'),
    'state',
    'Estado',
    'reference',
    (SELECT sys_id FROM sys_db_object WHERE name = 'sys_state'),
    TRUE,
    '30000000-0000-0000-0000-000000000002'
);
```

### 4.3 Detecção Automática pela FSM Engine
Quando uma operação de escrita ocorre em qualquer tabela (ex.: `tbl_incident`), o orquestrador executa a seguinte CTE para identificar colunas gerenciadas pela FSM:

```sql
WITH RECURSIVE lineage AS (
    SELECT sys_id, super_class_id FROM sys_db_object WHERE sys_id = $1
    UNION ALL
    SELECT p.sys_id, p.super_class_id FROM sys_db_object p
    JOIN lineage l ON l.super_class_id = p.sys_id
)
SELECT DISTINCT d.column_name
FROM sys_dictionary d
JOIN lineage l ON d.table_id = l.sys_id
WHERE d.internal_type = 'reference'
  AND d.reference_table_id = (SELECT sys_id FROM sys_db_object WHERE name = 'sys_state');
```

Toda coluna retornada (ex.: `state`) tem seu ciclo de vida interceptado e controlado pela FSM.

---

## 5. Resolução Polimórfica de Transições com Herança e Labels (CTE)

Ao listar transições disponíveis para uma tabela derivada (ex.: `tbl_incident`), a CTE recursiva percorre os ancestrais e junta os dados com `sys_state` para obter rótulos e nomes amigáveis:

```sql
WITH RECURSIVE table_lineage AS (
    SELECT sys_id, name, super_class_id, 0 AS depth
    FROM sys_db_object
    WHERE name = 'tbl_incident'

    UNION ALL

    SELECT parent.sys_id, parent.name, parent.super_class_id, tl.depth + 1
    FROM sys_db_object parent
    JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
)
SELECT DISTINCT ON (st.from_state_id, st.to_state_id)
    st.sys_id,
    st.from_state_id,
    COALESCE(fs.name, st.from_state, '') AS from_state_name,
    COALESCE(fs.label, st.from_state, '') AS from_state_label,
    st.to_state_id,
    COALESCE(ts.name, st.to_state, '') AS to_state_name,
    COALESCE(ts.label, st.to_state, '') AS to_state_label,
    st.label,
    st.required_role_id,
    st.condition_tree,
    st.on_transition_action,
    tl.name AS defined_in_table,
    tl.depth
FROM table_lineage tl
JOIN sys_state_transition st ON st.table_id = tl.sys_id
LEFT JOIN sys_state fs ON fs.sys_id = st.from_state_id
LEFT JOIN sys_state ts ON ts.sys_id = st.to_state_id
WHERE st.state_field = 'state' AND st.is_active = TRUE
ORDER BY st.from_state_id, st.to_state_id, tl.depth ASC;
```

---

## 6. Pipeline de Validação no Backend Orchestrator

Quando uma requisição de atualização tenta alterar o campo de estado (`NEW.state != OLD.state`), o backend intercepta o fluxo antes da persistência física:

```
[Payload Recebido: state = 'resolved' ou UUID de 'resolved']
│
▼
1. O valor é uma referência a sys_state?
   └─ SIM ──► ResolveState(val) -> obtém sys_id, name ('resolved'), label ('Resolvido')
│
▼
2. O campo de estado mudou (target_id != current_id)?
   ├─ NÃO ──► Prossegue para o Update regular
   └─ SIM
       │
       ▼
3. Existe transição cadastrada para (tabela/lineage, from_state_id -> to_state_id)?
   ├─ NÃO ──► ABORT 400: "Transição de estado inválida de [Novo] para [Resolvido]."
   └─ SIM
       │
       ▼
4. Usuário tem permissão execute para transition:<from>:<to> ou role admin?
   ├─ NÃO ──► ABORT 403: "Ação não autorizada para o perfil do usuário."
   └─ SIM
       │
       ▼
5. required_role_id é NULL ou o usuário possui a role associada?
   ├─ NÃO ──► ABORT 403: "Permissão insuficiente: role requerida não atribuída."
   └─ SIM
       │
       ▼
6. Registro proposto satisfaz a condition_tree exigida (AST)?
   ├─ NÃO ──► ABORT 400: "Condições obrigatórias para a transição não atendidas."
   └─ SIM
       │
       ▼
7. Executa on_transition_action + grava to_state_id UUID no registro + Auditoria Universal
```

---

## 7. Estrutura de Efeitos Colaterais (`on_transition_action`)

O campo `on_transition_action` define mutações automáticas nos atributos do registro executadas na mesma transação atômica da mudança de estado:

```json
{
  "set_fields": {
    "close_notes": "Problema solucionado pela engenharia.",
    "resolved_at": "$NOW",
    "resolved_by": "$CURRENT_USER"
  }
}
```

* `$NOW`: Carimbo de data/hora atual UTC gravado no formato `TIMESTAMPTZ`.
* `$CURRENT_USER`: Substituído automaticamente pelo `sys_user.sys_id` do usuário autenticado no contexto.

---

## 8. Geração Automática de UI Actions (Botões Dinâmicos no Frontend)

O backend disponibiliza o endpoint:
```http
GET /api/v1/records/:table/:sys_id/available-transitions
```

Ao carregar o formulário do registro no frontend Next.js:
1. O frontend chama este endpoint passando o token JWT do usuário autenticado.
2. O backend avalia o `state` atual no banco, os papéis efetivos do usuário e validações da `condition_tree`.
3. Retorna a lista de ações permitidas com rótulos amigáveis:
   ```json
   [
     {
       "transition_id": "471506b0-5985-4d50-842e-90c7fff69264",
       "from_state_id": "30000000-0000-0000-0000-000000000002",
       "from_state": "new",
       "from_state_label": "Novo",
       "to_state_id": "30000000-0000-0000-0000-000000000003",
       "to_state": "in_progress",
       "to_state_label": "Em Andamento",
       "label": "Iniciar Atendimento",
       "action_name": "transition:new:in_progress",
       "defined_in_table": "tbl_incident"
     }
   ]
   ```
4. A UI renderiza os botões dinamicamente no cabeçalho do formulário.
5. Ao clicar, despacha a requisição atômica para:
   ```http
   POST /api/v1/records/:table/:sys_id/transitions/:transition_id
   ```

---

## 9. Contratos REST do Ciclo de Vida de Estados (`/fsm/states`)

* `GET /api/v1/fsm/states` (Listagem completa ordenada por sequência)
* `GET /api/v1/fsm/states/:state_id` (Consulta individual de detalhes)
* `POST /api/v1/fsm/states` (Criação de novo estado)
* `PUT /api/v1/fsm/states/:state_id` (Atualização in-place de rótulo, cor, sequência e status)
* `DELETE /api/v1/fsm/states/:state_id` (Exclusão física com verificação de FKs ativas)
