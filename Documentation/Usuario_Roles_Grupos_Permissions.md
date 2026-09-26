# Modelo de Controle de Acesso: Usuários, Grupos, Roles e Permissões (RBAC)

Este documento especifica a cadeia de concessão e o modelo de governança de segurança do **TableEngine**, inspirado no modelo do ServiceNow: **Usuário $\rightarrow$ Grupos $\rightarrow$ Roles $\rightarrow$ Permissões**.

---

## 1. Princípios da Cadeia de Concessão

1. **Sem Atribuições Diretas:**
   * Usuários **não** recebem roles diretamente. Roles são atribuídas exclusivamente a **Grupos**.
   * Usuários e Grupos **não** recebem permissões diretamente. Permissões são atribuídas exclusivamente a **Roles**.
2. **Identidade via UUID:**
   * Toda PK e FK utiliza **UUID v4**. `user_name` e `email` servem exclusivamente para apresentação visual e autenticação.
3. **Cálculo de Acesso Efetivo em Tempo Real:**
   * As roles ativas de um usuário correspondem à união (sem duplicatas) das roles ativas de todos os grupos ativos dos quais ele é membro.
   * As permissões ativas correspondem à união das permissões atribuídas a essas roles.
   * Não há cache de permissões nesta fase; o PostgreSQL é consultado em tempo real em cada requisição.

---

## 2. Modelagem das Tabelas do Kernel

### 2.1 Usuário (`sys_user`)
```sql
CREATE TABLE sys_user (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name VARCHAR(100) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    email VARCHAR(254),
    phone VARCHAR(40),
    job_title VARCHAR(120),
    department VARCHAR(120),
    company VARCHAR(120),
    manager_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    locale VARCHAR(20),
    time_zone VARCHAR(80),
    is_service_account BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);
```

### 2.2 Grupo (`sys_user_group`)
```sql
CREATE TABLE sys_user_group (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    manager_id UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
```

### 2.3 Papel Funcional (`sys_user_role`)
```sql
CREATE TABLE sys_user_role (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
```

### 2.4 Permissão de Recurso (`sys_permission`)
```sql
CREATE TABLE sys_permission (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    table_id UUID NOT NULL REFERENCES sys_db_object(sys_id) ON DELETE RESTRICT,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('create','read','update','delete','execute')),
    field_name VARCHAR(80),
    action_name VARCHAR(100),
    condition_tree JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (field_name IS NULL OR operation IN ('create','read','update')),
    CHECK ((operation = 'execute' AND action_name IS NOT NULL AND field_name IS NULL)
        OR (operation <> 'execute' AND action_name IS NULL))
);
```

---

## 3. Tabelas de Vínculo (Muitos-para-Muitos)

### 3.1 Membro de Grupo (`sys_user_grmember`)
```sql
CREATE TABLE sys_user_grmember (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    group_id UUID NOT NULL REFERENCES sys_user_group(sys_id) ON DELETE RESTRICT,
    UNIQUE (user_id, group_id)
);
CREATE INDEX idx_grmember_group ON sys_user_grmember(group_id, user_id);
```

### 3.2 Role do Grupo (`sys_group_has_role`)
```sql
CREATE TABLE sys_group_has_role (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES sys_user_group(sys_id) ON DELETE RESTRICT,
    role_id UUID NOT NULL REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    UNIQUE (group_id, role_id)
);
CREATE INDEX idx_group_role_role ON sys_group_has_role(role_id, group_id);
```

### 3.3 Permissão da Role (`sys_role_has_permission`)
```sql
CREATE TABLE sys_role_has_permission (
    sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES sys_user_role(sys_id) ON DELETE RESTRICT,
    permission_id UUID NOT NULL REFERENCES sys_permission(sys_id) ON DELETE RESTRICT,
    UNIQUE (role_id, permission_id)
);
CREATE INDEX idx_role_permission_permission ON sys_role_has_permission(permission_id, role_id);
```

---

## 4. Regras de Integridade de Negócio

1. **Ao Menos Um Grupo Ativo por Usuário Ativo:**
   * Usuários podem ser cadastrados como inativos sem grupo.
   * Criar um usuário como `is_active = true` ou ativá-lo exige vinculação a pelo menos um grupo ativo.
   * Remover o último grupo de um usuário ativo ou desativar esse grupo exige transferi-lo para outro grupo ativo ou desativar o usuário na mesma transação sob isolamento `SERIALIZABLE`.
2. **Preservação de Histórico (`ON DELETE RESTRICT`):**
   * Usuários e cadastros de segurança referenciados em auditoria e metadados não podem ser excluídos fisicamente se vinculados a logs imutáveis. Utiliza-se desativação lógica (`is_active = false`) ou exclusão em cascata controlada dos vínculos associativos (`sys_user_grmember`, `sys_group_has_role`, `sys_role_has_permission`).

---

## 5. Ciclo de Vida CRUD e Visualização em Formulário Próprio (Form View)

Seguindo o padrão unificado de interface do **TableEngine**:
* **Páginas Dedicadas (Sem Diálogos/Modais):** Cada entidade de segurança (`sys_user`, `sys_user_group`, `sys_user_role`, `sys_permission`) possui sua própria página de visualização e edição detalhada, eliminando modais e diálogos sobrepostos.
* **Edição no Mesmo Formulário (In-Place Edit):** A página de detalhes abre inicialmente em modo de leitura (visualização dos campos formatados). Ao clicar no botão **"Editar"**, a página entra em modo de edição mantendo **exatamente as mesmas posições dos componentes na tela**, permitindo alterar os campos e salvar no mesmo layout.
* **Exclusão com Feedback Seguro:** Cada entidade possui o botão **"Excluir"** no cabeçalho do formulário, que valida vínculos e executa a remoção atômica no banco com retorno à listagem.
* **Gerenciamento de Credenciais:** Ao criar ou atualizar um usuário em seu formulário, a senha informada é criptografada com **bcrypt** (fator de custo 12) e persistida em `sys_user_credential`.
* **Vínculos M:N Diretos no Formulário:**
  * O formulário do Usuário permite selecionar e vincular Grupos diretamente.
  * O formulário do Grupo permite selecionar e vincular Roles diretamente.
  * O formulário da Role permite selecionar e vincular Permissões diretamente.

