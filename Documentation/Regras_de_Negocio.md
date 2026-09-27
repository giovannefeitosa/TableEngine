# Especificação da Engine de Regras de Negócio (`sys_script`)

Este documento detalha o funcionamento, modelagem, ciclo de vida, estrutura de condições declarativas (AST) e ações suportadas pela **Engine de Regras de Negócio (Business Rules)** do TableEngine.

---

## 1. Visão Geral e Princípios Fundamentais

* **Automação Declarativa:** As regras de negócio permitem validar, enriquecer dados e orquestrar efeitos colaterais no fluxo de CRUD de forma dinâmica, sem exigir alterações no código-fonte compilado ou scripts manuais de banco.
* **Persistência no Kernel:** Toda regra é armazenada e configurada na tabela `sys_script`.
* **Polimorfismo:** Regras cadastradas em classes base (ex.: `tbl_task`) são herdadas e executadas automaticamente para todas as suas tabelas derivadas (ex.: `tbl_incident`).

---

## 2. Estrutura da Tabela `sys_script`

```sql
CREATE TABLE sys_script (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    timing VARCHAR(20) NOT NULL CHECK (timing IN ('before_insert', 'before_update', 'after_insert', 'after_update')),
    execution_order INTEGER NOT NULL DEFAULT 100,
    execution_mode VARCHAR(10) NOT NULL DEFAULT 'caller' CHECK (execution_mode IN ('caller', 'service')),
    run_as_user_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    condition_expression JSONB NOT NULL,
    action_type VARCHAR(40) NOT NULL CHECK (action_type IN ('set_field_value', 'abort_transaction', 'execute_script')),
    action_payload JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    CONSTRAINT ck_script_actor CHECK (
        (execution_mode = 'caller' AND run_as_user_id IS NULL)
        OR (execution_mode = 'service' AND run_as_user_id IS NOT NULL)
    )
);

CREATE INDEX idx_script_execution ON sys_script(table_id, timing, execution_order) WHERE is_active = TRUE;
```

---

## 3. Momentos de Execução (Timings)

| Timing | Momento de Disparo | Escopo Transacional | Acesso a Variáveis | Casos de Uso Típicos |
| :--- | :--- | :--- | :--- | :--- |
| `before_insert` | Antes de persistir no banco | Mesma transação (antes do INSERT) | `current`, `user` | Sanitização, valores padrão, validações de bloqueio |
| `before_update` | Antes de persistir as mudanças | Mesma transação (antes do UPDATE) | `current`, `previous`, `user` | Cálculo de campos dependentes, validações de transição |
| `after_insert` | Imediatamente após INSERT físico | Mesma transação (após o INSERT) | `current`, `user` | Criação de registros vinculados, disparo de contadores |
| `after_update` | Imediatamente após UPDATE físico | Mesma transação (após o UPDATE) | `current`, `previous`, `user` | Registro de eventos, logs especializados, notificações |

---

## 4. Contexto de Execução Fornecido à Regra

Durante a avaliação da condição e a execução da ação, a engine disponibiliza as seguintes variáveis imutáveis para a regra:

1. `current`: Estrutura JSON contendo os valores do registro sendo inserido ou atualizado (com todas as colunas resolvidas da hierarquia).
2. `previous`: Estrutura JSON contendo o estado anterior do registro no banco antes do update (disponível apenas em `before_update` e `after_update`; `null` em inserções).
3. `user`: Objeto com a identidade autenticada:
   ```json
   {
     "sys_id": "00000000-0000-4000-8000-000000000003",
     "user_name": "carlos.silva",
     "roles": ["itil_resolver", "service_desk"]
   }
   ```

---

## 5. Especificação de `condition_expression` (Árvore de Condições)

A condição é uma **Abstract Syntax Tree (AST)** declarativa compatível com o padrão do documento `Condition_Tree.md`. A regra só é executada se a árvore lógica retornar `true`.

### Exemplo 1: Validação de Severidade Alta sem Descrição
```json
{
  "operator": "AND",
  "rules": [
    {
      "field": "severity",
      "operator": "EQUALS",
      "value": 1
    },
    {
      "field": "short_description",
      "operator": "IS_EMPTY"
    }
  ]
}
```

### Exemplo 2: Detecção de Mudança de Campo (Update)
```json
{
  "operator": "AND",
  "rules": [
    {
      "field": "state",
      "operator": "CHANGED_TO",
      "value": "resolved"
    },
    {
      "field": "close_notes",
      "operator": "IS_EMPTY"
    }
  ]
}
```

---

## 6. Ações Suportadas (`action_type` e `action_payload`)

### 6.1 `action_type = 'set_field_value'`
Atribui valores a um campo do registro no contexto `before_insert` ou `before_update`.

* **Payload Estático:**
  ```json
  {
    "field": "priority",
    "value": 1
  }
  ```
* **Payload com Concatenação/Template:**
  ```json
  {
    "field": "short_description",
    "template": "[URGENTE] {{short_description}}"
  }
  ```

### 6.2 `action_type = 'abort_transaction'`
Interrompe imediatamente o processamento, desfaz as operações da transação via `ROLLBACK` e retorna erro HTTP informativo para o cliente.

* **Payload:**
  ```json
  {
    "message": "Operação bloqueada: Não é permitido salvar incidentes com gravidade 1 sem preencher a descrição detalhada.",
    "status_code": 422
  }
  ```

### 6.3 `action_type = 'execute_script'`
Permite a execução de lógica procedural sandboxed (em VM isolada ECMAScript através do interpretador embutido no Golang).

* **Payload:**
  ```json
  {
    "script": "if (current.severity === 1 && current.urgency === 1) { current.priority = 1; } else { current.priority = 2; }"
  }
  ```
* **Garantias de Segurança:**
  * **Timeout Rígido:** Execução interrompida após 500ms.
  * **Zero I/O Não Autorizado:** O script não tem acesso a chamadas de rede ou sistema de arquivos do servidor.

---

## 7. Herança de Regras em Tabelas TPT

A resolução de regras é polimórfica:

```
[tbl_task] (Regra A: ordem 100, Regra B: ordem 200)
    ▲
    │ herda de tbl_task
[tbl_incident] (Regra C: ordem 150)
```

1. Quando um registro de `tbl_incident` sofre uma operação, a engine consulta recursivamente todas as regras ativas de `tbl_incident` e seus ancestrais (`tbl_task`).
2. As regras são ordenadas por nível de herança decrescente (ancestrais primeiro) e depois por `execution_order ASC`:
   * 1º: Regra A (`tbl_task`, ordem 100)
   * 2º: Regra C (`tbl_incident`, ordem 150)
   * 3º: Regra B (`tbl_task`, ordem 200)

---

## 8. Ciclo de Vida CRUD e Visualização em Página Própria de Detalhes

* **Página Própria de Cada Regra:** No Rules Studio, clicar em qualquer regra de negócio ou em "Nova Regra" abre a página dedicada da entidade `sys_script`, eliminando diálogos sobrepostos.
* **Edição In-Place na Mesma Tela:** A página de detalhes exibe todos os parâmetros (nome, tabela, timing, ordem de execução, modo de execução, usuário executor, tipo de ação, condição AST e payload da ação). O botão **"Editar Regra"** permite modificar qualquer propriedade mantendo rigorosamente a mesma disposição visual na tela.
* **Botão Split de Salvamento com Dropdown:**
  * Durante a edição de uma regra de negócio existente, o botão **"Salvar Regra"** opera como um botão dividido (*split button*) com um gatilho dropdown (seta para baixo) à sua direita.
  * O clique direto no botão principal executa a atualização in-place da regra atual (`PUT /api/v1/rules/scripts/:rule_id`).
  * Ao clicar na seta dropdown, um menu contextual com duas opções avançadas é exibido:
    1. **"Salvar como nova regra":**
       * Clona as configurações em edição para um novo registro independente na tabela `sys_script` via `POST /api/v1/rules/scripts`, preservando a regra original completamente inalterada.
       * Executa toda a validação de um novo registro:
         * Validação de `name` obrigatório;
         * Validação de existência da tabela alvo (`table_id`) no catálogo `sys_db_object`;
         * Validação de momento de disparo (`timing` em `before_insert`, `before_update`, `after_insert`, `after_update`);
         * Validação do modo de execução (`execution_mode`) e obrigatoriedade do usuário executor (`run_as_user_id`) ativo quando no modo `service`;
         * Validação de conformidade estrutural da Árvore de Condições (AST JSONB);
         * Validação dos campos obrigatórios do payload conforme o tipo de ação (`message` para `abort_transaction`, `field` para `set_field_value`, `script` para `execute_script`).
       * Não interfere em outras funcionalidades ou regras existentes. Se qualquer regra ou restrição de validação for violada, a operação é interrompida com erro detalhado e o formulário permanece aberto com os dados intactos para correção.
       * Em caso de sucesso, carrega a nova regra recém-criada em modo de visualização detalhada e atualiza a listagem geral.
    2. **"Deletar":**
       * Dispara um diálogo modal de confirmação contendo aviso de permanência, identificação da regra e opções explícitas de confirmação ("Cancelar" e "Sim, Excluir").
       * Ao confirmar com "Sim, Excluir", executa `DELETE /api/v1/rules/scripts/:rule_id`, exibe notificação de sucesso e retorna instantaneamente para a listagem de regras.
* **Exclusão com Confirmação Modal:** Tanto na visualização direta (botão "Excluir") quanto no menu dropdown do modo de edição (opção "Deletar"), a exclusão exige confirmação explícita via modal antes do expurgo físico da tupla no PostgreSQL.
* **Contratos REST de Suporte:**
  * `GET /api/v1/rules/scripts` (Listagem com filtros de tabela e pesquisa)
  * `GET /api/v1/rules/scripts/:rule_id` (Consulta individual detalhada de atributos, AST e payload)
  * `POST /api/v1/rules/scripts` (Criação de nova regra com validação completa de AST, integridade de atores e payload)
  * `PUT /api/v1/rules/scripts/:rule_id` (Atualização atômica in-place com validação de campos alterados)
  * `DELETE /api/v1/rules/scripts/:rule_id` (Exclusão física com expurgo de trigger)

