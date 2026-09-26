# Especificação Formal dos Contratos da API REST (TableEngine)

Esta especificação define todos os contratos HTTP da API REST do **TableEngine**, incluindo rotas, métodos, parâmetros, cabeçalhos, esquemas de payload JSON de requisição e resposta, e códigos de status HTTP padronizados.

---

## 1. Padrões Globais da API

* **Base URL:** `/api/v1`
* **Formato de Dados:** `application/json` (UTF-8)
* **Padrão de Datas:** ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`)
* **Identificadores:** UUID v4 para todas as chaves primárias e relacionamentos (`sys_id`, `table_id`, etc.)
* **Cabeçalhos Padrão de Requisição:**
  * `Authorization: Bearer <JWT_TOKEN>` (Obrigatório em todas as rotas protegidas)
  * `Content-Type: application/json` (Obrigatório para métodos com corpo)
* **Formato Padrão de Resposta de Erro:**
  ```json
  {
    "error": {
      "code": "CONCURRENCY_CONFLICT",
      "message": "O registro foi modificado por outro usuário (versão esperada: 2, versão atual: 3).",
      "details": null
    }
  }
  ```
* **Códigos de Status HTTP Padronizados:**
  * `200 OK`: Operação de leitura ou atualização concluída com sucesso.
  * `201 Created`: Recurso criado fisicamente com sucesso.
  * `204 No Content`: Operação concluída sem corpo de resposta (ex.: exclusão).
  * `400 Bad Request`: Requisição malformada ou falha em validações de entrada.
  * `401 Unauthorized`: Token ausente, inválido ou expirado.
  * `403 Forbidden`: Usuário não possui permissão explícita na classe/campo/ação.
  * `404 Not Found`: Tabela, campo, registro ou recurso inexistente.
  * `409 Conflict`: Conflito de versão em concorrência otimista (`sys_mod_count`) ou violação de unicidade.
  * `422 Unprocessable Entity`: Transição de estado inválida, condição de regra de negócio violada (`abort_transaction`).
  * `500 Internal Server Error`: Erro interno no PostgreSQL ou no orquestrador.

---

## 2. Autenticação e Sessão (`/auth`)

### 2.1 Login e Obtenção de Token
* **Método:** `POST`
* **Rota:** `/api/v1/auth/login`
* **Descrição:** Autentica credenciais de usuário e emite token JWT com a identidade (`sys_user.sys_id`).
* **Request Body:**
  ```json
  {
    "user_name": "admin",
    "password": "SecretPassword123!"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "sys_id": "00000000-0000-4000-8000-000000000002",
      "user_name": "admin",
      "first_name": "System",
      "last_name": "Administrator",
      "email": "admin@empresa.com"
    }
  }
  ```

### 2.2 Perfil e Permissões Efetivas do Usuário Autenticado
* **Método:** `GET`
* **Rota:** `/api/v1/auth/me`
* **Descrição:** Retorna a identidade autenticada, seus grupos ativos, roles herdadas e catálogo de permissões calculadas diretamente no PostgreSQL (sem cache).
* **Response (200 OK):**
  ```json
  {
    "sys_id": "00000000-0000-4000-8000-000000000003",
    "user_name": "analista.suporte",
    "first_name": "Carlos",
    "last_name": "Silva",
    "email": "carlos.silva@empresa.com",
    "is_active": true,
    "groups": [
      {
        "sys_id": "33333333-3333-3333-3333-333333333333",
        "name": "Gestão de Incidentes"
      }
    ],
    "roles": [
      {
        "sys_id": "44444444-4444-4444-4444-444444444444",
        "name": "itil_resolver"
      }
    ]
  }
  ```

---

## 3. Catálogo de Metadados e DDL Engine (`/schema`)

### 3.1 Listar Classes/Tabelas Cadastradas
* **Método:** `GET`
* **Rota:** `/api/v1/schema/tables`
* **Query Params:**
  * `include_kernel`: `boolean` (opcional, default: `false` — se true, inclui tabelas `sys_*`)
* **Response (200 OK):**
  ```json
  [
    {
      "sys_id": "11111111-1111-1111-1111-111111111111",
      "name": "tbl_task",
      "label": "Tarefa",
      "super_class_id": null,
      "is_extendable": true,
      "is_kernel_table": false,
      "sys_created_on": "2026-09-26T12:00:00Z"
    },
    {
      "sys_id": "22222222-2222-2222-2222-222222222222",
      "name": "tbl_incident",
      "label": "Incidente",
      "super_class_id": "11111111-1111-1111-1111-111111111111",
      "is_extendable": true,
      "is_kernel_table": false,
      "sys_created_on": "2026-09-26T12:05:00Z"
    }
  ]
  ```

### 3.2 Criar Nova Tabela (Raiz ou Filha TPT)
* **Método:** `POST`
* **Rota:** `/api/v1/schema/tables`
* **Regra DDL:**
  * O nome físico recebe prefixo `tbl_` automaticamente se omitido.
  * Se `super_class_id` for `null`, cria tabela raiz com colunas de kernel (`sys_id`, `sys_class_name`, `sys_created_on`, etc.).
  * Se `super_class_id` for informado, valida ausência de ciclos, cria tabela física filha com `sys_id UUID PRIMARY KEY REFERENCES tbl_<parent>(sys_id) ON DELETE CASCADE` e gera a view polimórfica `v_<nome>`.
  * Vincula a trigger de auditoria `trg_generic_audit_diff` automaticamente.
* **Request Body:**
  ```json
  {
    "name": "tbl_change_request",
    "label": "Mudança",
    "super_class_id": "11111111-1111-1111-1111-111111111111",
    "is_extendable": true
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "sys_id": "55555555-5555-5555-5555-555555555555",
    "name": "tbl_change_request",
    "label": "Mudança",
    "super_class_id": "11111111-1111-1111-1111-111111111111",
    "is_extendable": true,
    "is_kernel_table": false,
    "view_name": "v_change_request",
    "sys_created_on": "2026-09-26T12:10:00Z"
  }
  ```

### 3.3 Adicionar Campo a uma Tabela
* **Método:** `POST`
* **Rota:** `/api/v1/schema/tables/:table_id/fields`
* **Regra DDL:**
  * Registra em `sys_dictionary`.
  * Executa `ALTER TABLE <table_name> ADD COLUMN <column_name> <TIPO_POSTGRES>`.
  * Atualiza automaticamente as views polimórficas de todas as tabelas descendentes para incluir o novo atributo.
* **Request Body:**
  ```json
  {
    "column_name": "impact",
    "label": "Impacto no Negócio",
    "internal_type": "integer",
    "is_mandatory": false,
    "is_read_only": false,
    "default_value": "3"
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "sys_id": "66666666-6666-6666-6666-666666666666",
    "table_id": "22222222-2222-2222-2222-222222222222",
    "column_name": "impact",
    "label": "Impacto no Negócio",
    "internal_type": "integer",
    "max_length": 255,
    "is_mandatory": false,
    "is_read_only": false,
    "default_value": "3"
  }
  ```

### 3.4 Resolver Dicionário de Campos com Herança (CTE)
* **Método:** `GET`
* **Rota:** `/api/v1/schema/tables/:table_name/fields`
* **Descrição:** Executa a CTE recursiva de linhagem da Seção 5 da documentação para retornar todos os atributos herdados e próprios da classe concreta, ordenados por `inheritance_level DESC, column_name ASC`.
* **Response (200 OK):**
  ```json
  [
    {
      "column_name": "number",
      "label": "Número",
      "internal_type": "auto_number",
      "is_mandatory": true,
      "is_read_only": true,
      "default_value": null,
      "defined_in_table": "tbl_task",
      "inheritance_level": 1
    },
    {
      "column_name": "short_description",
      "label": "Descrição Curta",
      "internal_type": "string",
      "is_mandatory": false,
      "is_read_only": false,
      "default_value": null,
      "defined_in_table": "tbl_task",
      "inheritance_level": 1
    },
    {
      "column_name": "severity",
      "label": "Gravidade",
      "internal_type": "integer",
      "is_mandatory": false,
      "is_read_only": false,
      "default_value": null,
      "defined_in_table": "tbl_incident",
      "inheritance_level": 0
    }
  ]
  ```

### 3.5 Cadastrar Opção de Dropdown (`sys_choice`)
* **Método:** `POST`
* **Rota:** `/api/v1/schema/choices`
* **Request Body:**
  ```json
  {
    "table_id": "11111111-1111-1111-1111-111111111111",
    "element": "state",
    "value": "in_progress",
    "label": "Em Andamento",
    "sequence": 20
  }
  ```
* **Response (201 Created)**

### 3.6 Configurar Numeração Automática (`sys_number`)
* **Método:** `POST`
* **Rota:** `/api/v1/schema/numbers`
* **Request Body:**
  ```json
  {
    "table_id": "22222222-2222-2222-2222-222222222222",
    "field_name": "number",
    "prefix": "INC",
    "minimum_digits": 7,
    "start_number": 1
  }
  ```
* **Response (201 Created)**

---

## 4. CRUD Polimórfico de Registros (`/records`)

### 4.1 Inserção Polimórfica (Create)
* **Método:** `POST`
* **Rota:** `/api/v1/records/:table`
* **Regra de Transação:**
  * Valida permissão `create` na classe concreta e campos.
  * Injeta `set_config('app.user_id', sys_id_usuario, true)`.
  * Gera UUID v4 universal para o registro.
  * Gera o próximo número através de `sys_next_number()`.
  * Insere atributos comuns na tabela raiz (`sys_class_name = concrete_table`).
  * Insere atributos especializados nas tabelas filhas com o mesmo `sys_id`.
* **Request Body (ex: `:table = tbl_incident`):**
  ```json
  {
    "short_description": "VPN inoperante na filial",
    "state": "new",
    "caller_id": "00000000-0000-4000-8000-000000000003",
    "severity": 1
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "sys_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "number": "TSK0000001",
    "sys_class_name": "tbl_incident",
    "short_description": "VPN inoperante na filial",
    "state": "new",
    "caller_id": "00000000-0000-4000-8000-000000000003",
    "severity": 1,
    "sys_created_on": "2026-09-26T12:15:00Z",
    "sys_mod_count": 0
  }
  ```

### 4.2 Leitura Polimórfica com Paginação e Filtros (Read List)
* **Método:** `GET`
* **Rota:** `/api/v1/records/:table`
* **Query Params:**
  * `limit`: int (padrão: 50, máx: 200)
  * `offset`: int (padrão: 0)
  * `sort_by`: string (campo para ordenação, ex.: `sys_created_on`)
  * `sort_dir`: `asc` | `desc` (padrão: `desc`)
  * `query`: string (filtro simples ou query formatada)
* **Response (200 OK):**
  ```json
  {
    "meta": {
      "table": "tbl_incident",
      "total_count": 142,
      "limit": 50,
      "offset": 0
    },
    "data": [
      {
        "sys_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "number": "TSK0000001",
        "sys_class_name": "tbl_incident",
        "short_description": "VPN inoperante na filial",
        "state": "new",
        "severity": 1,
        "sys_created_on": "2026-09-26T12:15:00Z",
        "sys_mod_count": 0
      }
    ]
  }
  ```

### 4.3 Leitura Única Consolidada (Read Single)
* **Método:** `GET`
* **Rota:** `/api/v1/records/:table/:sys_id`
* **Descrição:** Retorna todos os campos do registro consultando a view polimórfica correspondente (`v_<table_name>`) ou consolidando os níveis TPT.
* **Response (200 OK)**: Objeto com todas as colunas unificadas.

### 4.4 Atualização com Concorrência Otimista (Update)
* **Método:** `PUT`
* **Rota:** `/api/v1/records/:table/:sys_id`
* **Regras de Negócio e Concorrência:**
  * O cliente DEVE enviar `sys_mod_count` correspondente à versão que ele leu.
  * Se `state` for alterado, despacha para a Máquina de Estados (validação da transição, `required_role_id` e `condition_tree`).
  * Atualiza a tabela raiz com `sys_mod_count = sys_mod_count + 1 WHERE sys_id = $1 AND sys_mod_count = $2`.
  * Se 0 linhas forem afetadas na raiz, aborta com `409 Conflict` (`ConcurrencyConflictException`).
  * Atualiza tabelas filhas com seus respectivos campos.
* **Request Body:**
  ```json
  {
    "sys_mod_count": 0,
    "short_description": "VPN inoperante - escopo expandido",
    "severity": 2
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "sys_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "sys_mod_count": 1,
    "short_description": "VPN inoperante - escopo expandido",
    "severity": 2,
    "sys_updated_on": "2026-09-26T12:20:00Z"
  }
  ```

### 4.5 Exclusão Polimórfica em Cascata (Delete)
* **Método:** `DELETE`
* **Rota:** `/api/v1/records/:table/:sys_id`
* **Regra:**
  * O backend valida permissão `delete` na classe concreta.
  * Executa `DELETE FROM tbl_<raiz> WHERE sys_id = $1`.
  * O PostgreSQL remove automaticamente as linhas correspondentes em todas as tabelas filhas via restrição `ON DELETE CASCADE`.
* **Response (204 No Content)**

---

## 5. Máquina de Estados e Ações de Transição (`/fsm`)

### 5.1 Consultar Transições Disponíveis para o Registro (UI Actions)
* **Método:** `GET`
* **Rota:** `/api/v1/records/:table/:sys_id/available-transitions`
* **Descrição:** Executa a CTE recursiva de herança de transições a partir do `state` atual do registro, cruzando com os papéis do usuário (`required_role_id`) e avaliando a `condition_tree`. Retorna exclusivamente as transições autorizadas para renderização dos botões dinâmicos na interface.
* **Response (200 OK):**
  ```json
  [
    {
      "transition_id": "77777777-7777-7777-7777-777777777777",
      "from_state": "in_progress",
      "to_state": "resolved",
      "label": "Resolver Incidente",
      "action_name": "transition:in_progress:resolved",
      "defined_in_table": "tbl_incident",
      "requires_fields": ["close_notes"]
    }
  ]
  ```

### 5.2 Executar Transição de Estado
* **Método:** `POST`
* **Rota:** `/api/v1/records/:table/:sys_id/transitions/:transition_id`
* **Descrição:** Dispara uma transição de forma atômica, validando concorrência (`sys_mod_count`), reavaliando condições, aplicando `on_transition_action` e atualizando o registro.
* **Request Body:**
  ```json
  {
    "sys_mod_count": 1,
    "payload": {
      "close_notes": "Problema resolvido após reinicialização do concentrador VPN.",
      "severity": 2
    }
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "sys_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "state": "resolved",
    "sys_mod_count": 2,
    "close_notes": "Problema resolvido após reinicialização do concentrador VPN.",
    "sys_updated_on": "2026-09-26T12:25:00Z"
  }
  ```

---

## 6. Trilha de Auditoria Universal (`/audit`)

### 6.1 Consultar Histórico do Registro
* **Método:** `GET`
* **Rota:** `/api/v1/records/:table/:sys_id/audit`
* **Descrição:** Retorna a linha do tempo completa de mudanças geradas pela trigger `trg_generic_audit_diff` em `sys_audit`, ordenada cronologicamente por `changed_on DESC`.
* **Response (200 OK):**
  ```json
  [
    {
      "sys_id": "88888888-8888-8888-8888-888888888888",
      "table_name": "tbl_incident",
      "operation": "UPDATE",
      "field_name": "state",
      "old_value": "in_progress",
      "new_value": "resolved",
      "changed_on": "2026-09-26T12:25:00Z",
      "changed_by": {
        "sys_id": "00000000-0000-4000-8000-000000000003",
        "user_name": "analista.suporte"
      }
    }
  ]
  ```
