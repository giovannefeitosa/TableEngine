# Especificação da Máquina de Estados e Ciclo de Vida Polimórfico (`State_Transitions`)

Este documento detalha o modelo da **Máquina de Estados Finita (FSM)** declarativa, orientada a metadados e polimórfica sobre a arquitetura TPT no **TableEngine**.

---

## 1. Visão Geral e Princípios Fundamentais

* **Governança de Ciclo de Vida:** O avanço de qualquer registro operacional (ex.: *Novo* $\rightarrow$ *Em Andamento* $\rightarrow$ *Resolvido* $\rightarrow$ *Fechado*) é controlado rigorosamente pela engine. Movimentações arbitrárias de status são bloqueadas.
* **Polimorfismo com Precedência:** Tabelas filhas herdam o campo `state` e as transições de sua classe pai, mas podem sobrescrever fluxos específicos ou estendê-los.
* **Autorização em Camadas:** Para executar uma transição, o usuário deve possuir:
  1. Permissão geral de `update` sobre o registro.
  2. Permissão de `execute` sobre a ação `transition:<from_state>:<to_state>`.
  3. A role específica exigida em `required_role_id` (se configurada).
  4. Satisfação integral das regras declarativas de negócio em `condition_tree`.

---

## 2. Modelagem do Catálogo (`sys_state_transition`)

```sql
CREATE TABLE sys_state_transition (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    state_field VARCHAR(80) NOT NULL DEFAULT 'state',
    from_state VARCHAR(50) NOT NULL,
    to_state VARCHAR(50) NOT NULL,
    label VARCHAR(80) NOT NULL,
    required_role_id UUID REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    condition_tree JSONB,
    on_transition_action JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    CONSTRAINT uq_state_transition UNIQUE (table_id, state_field, from_state, to_state)
);

CREATE INDEX idx_transition_lookup
ON sys_state_transition(table_id, state_field, from_state, to_state)
WHERE is_active = TRUE;
```

---

## 3. Resolução Polimórfica de Transições com Herança (CTE)

Quando uma tabela derivada (ex.: `tbl_incident`) herda o campo de estado da tabela base (`tbl_task`), o backend recupera as transições válidas considerando a hierarquia de classes através da CTE recursiva:

```sql
WITH RECURSIVE table_lineage AS (
    -- Ponto de partida: a tabela concreta
    SELECT sys_id, name, super_class_id, 0 AS depth
    FROM sys_db_object
    WHERE name = 'tbl_incident'

    UNION ALL

    -- Recursão ascendente: sobe para os ancestrais
    SELECT parent.sys_id, parent.name, parent.super_class_id, tl.depth + 1
    FROM sys_db_object parent
    JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
)
SELECT DISTINCT ON (st.from_state, st.to_state)
    st.sys_id,
    st.from_state,
    st.to_state,
    st.label,
    st.required_role_id,
    st.condition_tree,
    st.on_transition_action,
    tl.name AS defined_in_table,
    tl.depth
FROM table_lineage tl
JOIN sys_state_transition st ON st.table_id = tl.sys_id
WHERE st.state_field = 'state' AND st.is_active = TRUE
ORDER BY st.from_state, st.to_state, tl.depth ASC;
```

### Regra de Precedência:
* O `DISTINCT ON (st.from_state, st.to_state)` ordenado por `tl.depth ASC` garante que, se `tbl_incident` possuir uma transição configurada especificamente para `(in_progress -> resolved)`, ela terá prioridade absoluta sobre qualquer transição genérica herdada de `tbl_task`.

---

## 4. Pipeline de Validação no Backend Orchestrator

Quando uma requisição de atualização tenta alterar o campo de estado (`NEW.state != OLD.state`), o backend intercepta o fluxo antes de qualquer persistência física:

```
[Payload Recebido: state = 'resolved']
│
▼
1. O campo de estado mudou?
   ├─ NÃO ──► Prossegue para o Update regular
   └─ SIM
       │
       ▼
2. Existe transição cadastrada para (tabela, current_state -> target_state)?
   ├─ NÃO ──► ABORT 422: "Transição de estado inválida de [A] para [B]."
   └─ SIM
       │
       ▼
3. Usuário tem permissão execute para transition:<from>:<to>?
   ├─ NÃO ──► ABORT 403: "Ação não autorizada para o perfil do usuário."
   └─ SIM
       │
       ▼
4. required_role_id é NULL ou o usuário possui a role herdada de seus grupos ativos?
   ├─ NÃO ──► ABORT 403: "Permissão insuficiente: role requerida não atribuída."
   └─ SIM
       │
       ▼
5. Registro proposto satisfaz a condition_tree exigida?
   ├─ NÃO ──► ABORT 422: "Condições obrigatórias para a transição não atendidas."
   └─ SIM
       │
       ▼
6. Executa on_transition_action + UPDATE atômico com verificação de versão (sys_mod_count) + Auditoria
```

---

## 5. Estrutura de Efeitos Colaterais (`on_transition_action`)

O campo `on_transition_action` define mutações automáticas nos atributos do registro executadas na mesma transação da mudança de estado:

```json
{
  "set_fields": {
    "close_notes": "Incidente resolvido pela equipe de suporte N2",
    "resolved_at": "$NOW",
    "resolved_by": "$CURRENT_USER"
  }
}
```

* `$NOW`: Carimbo de data/hora atual UTC gravado no formato `TIMESTAMPTZ`.
* `$CURRENT_USER`: Substituído automaticamente pelo `sys_user.sys_id` do usuário da sessão.

---

## 6. Geração Automática de UI Actions (Botões Dinâmicos no Frontend)

O backend disponibiliza o endpoint:
```http
GET /api/v1/records/:table/:sys_id/available-transitions
```

Ao carregar o formulário do registro no frontend Next.js:
1. O frontend chama este endpoint passando o token JWT do usuário logado.
2. O backend avalia o `state` atual do registro no banco, os papéis efetivos do usuário e validações prévias da `condition_tree`.
3. Retorna exclusivamente a lista de ações que o usuário tem permissão de executar:
   ```json
   [
     {
       "transition_id": "77777777-7777-7777-7777-777777777777",
       "label": "Resolver Incidente",
       "from_state": "in_progress",
       "to_state": "resolved",
       "button_variant": "primary",
       "requires_fields": ["close_notes"]
     }
   ]
   ```
4. O componente de cabeçalho do formulário renderiza os botões dinamicamente (ex.: `[ Iniciar Atendimento ]`, `[ Resolver Incidente ]`, `[ Cancelar Chamado ]`).
5. Ao clicar, a UI abre eventuais campos obrigatórios não preenchidos e despacha a requisição para `POST /api/v1/records/:table/:sys_id/transitions/:transition_id`.
