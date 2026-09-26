# Arquitetura de Herança Dinâmica Table-per-Type (TPT)

Este documento especifica a estratégia de persistência **Dynamic Table-per-Type (TPT)** adotada pelo TableEngine, inspirada nos modelos de engenharia do ServiceNow e Salesforce Force.com sobre o PostgreSQL.

---

## 1. Fundamentos e Justificativa de Engenharia

Ao projetar uma plataforma aPaaS orientada a metadados no PostgreSQL com herança de entidades (ex.: `task` $\rightarrow$ `incident` $\rightarrow$ `security_incident`), três estratégias de persistência são classicamente consideradas:

| Estratégia | Descrição | Limitações no PostgreSQL | Decisão no TableEngine |
| :--- | :--- | :--- | :--- |
| **Single-Table (STI)** | Uma única tabela física gigante para toda a hierarquia com discriminador. | Atinge rapidamente o limite físico de 1.600 colunas do PostgreSQL; saturação de colunas nulas e quebra de constraints NOT NULL. | **Rejeitada** |
| **Concrete Table** | Tabelas filhas físicas duplicam integralmente todas as colunas de seus pais. | Consultas polimórficas na raiz (`SELECT FROM task`) exigiriam `UNION ALL` custoso; duplicidade de DDL e quebra de integridade referencial. | **Rejeitada** |
| **Table-per-Type (TPT)** | Cada nível da hierarquia possui sua própria tabela física; a chave primária da filha é também chave estrangeira para o pai. | Exige `JOIN` entre as tabelas na leitura completa, otimizado por chaves UUID e views polimórficas. | **Adotada (Vencedora)** |

---

## 2. Contrato Estrutural no PostgreSQL

### 2.1 Tabela Raiz (`super_class_id IS NULL`)
A tabela base abriga exclusivamente os atributos comuns a toda a hierarquia e o contrato obrigatório do Kernel:
* `sys_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`: Chave imutável universal.
* `sys_class_name VARCHAR(80) NOT NULL`: **Discriminador Polimórfico**. Guarda o nome da tabela física concreta do registro (ex.: `'tbl_incident'`). Permite que consultas na tabela raiz identifiquem a classe real de cada tupla para roteamento correto de UI.
* Metadados de auditoria: `sys_created_on`, `sys_created_by`, `sys_updated_on`, `sys_updated_by`.
* Concorrência: `sys_mod_count INTEGER NOT NULL DEFAULT 0`.

### 2.2 Tabelas Derivadas (`super_class_id IS NOT NULL`)
A tabela filha armazena exclusivamente os campos especializados adicionados ao seu próprio nível:
* `sys_id UUID PRIMARY KEY`: A chave da filha **não gera novo UUID**. Ela recebe exatamente o mesmo `sys_id` gerado para a tabela raiz.
* **Integridade Referencial com Cascata:**
  ```sql
  CONSTRAINT fk_incident_parent_task
      FOREIGN KEY (sys_id) REFERENCES tbl_task(sys_id) ON DELETE CASCADE
  ```
* Se um registro for excluído na tabela base (`tbl_task`), o PostgreSQL encarrega-se nativamente e atomicamente de remover a tupla correspondente em `tbl_incident`.

---

## 3. Resolução Dinâmica de Atributos (CTE Recursivo)

Como atributos herdados não são duplicados no catálogo `sys_dictionary`, a engine resolve a árvore completa de campos em tempo de execução via Common Table Expressions (CTE):

```sql
WITH RECURSIVE table_lineage AS (
    -- Ponto de partida: a classe concreta consultada
    SELECT sys_id, name, super_class_id, 0 AS inheritance_level
    FROM sys_db_object
    WHERE name = 'tbl_incident'

    UNION ALL

    -- Recursão ascendente: sobe a linhagem até a raiz
    SELECT parent.sys_id, parent.name, parent.super_class_id, tl.inheritance_level + 1
    FROM sys_db_object parent
    JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
)
SELECT
    d.column_name,
    d.label,
    d.internal_type,
    d.is_mandatory,
    d.is_read_only,
    d.default_value,
    tl.name AS defined_in_table,
    tl.inheritance_level
FROM table_lineage tl
JOIN sys_dictionary d ON d.table_id = tl.sys_id
ORDER BY tl.inheritance_level DESC, d.column_name ASC;
```

---

## 4. Operações de Dados Polimórficas (CRUD Engine)

### 4.1 Inserção Polimórfica (Create)
Ao criar um registro de classe derivada (ex.: `tbl_incident`), o orquestrador em Golang executa inserções coordenadas em transação única atômica:

```sql
BEGIN;
-- 1. Insere atributos base na raiz informando o discriminador concreto
INSERT INTO tbl_task (sys_id, sys_class_name, number, short_description, state, sys_created_by, sys_updated_by)
VALUES ($1, 'tbl_incident', $2, $3, 'new', $4, $4);

-- 2. Insere atributos especializados na filha reutilizando o mesmo sys_id
INSERT INTO tbl_incident (sys_id, severity, caller_id)
VALUES ($1, $5, $6);
COMMIT;
```

### 4.2 Leitura Polimórfica (Read)
* **Consulta Genérica:** Permite buscar em toda a hierarquia sem se preocupar com tipos específicos:
  ```sql
  SELECT sys_id, sys_class_name, number, short_description, state 
  FROM tbl_task 
  WHERE state = 'new';
  ```
* **Consulta Tipada Completa:** Utiliza a view polimórfica gerada pelo DDL Engine:
  ```sql
  SELECT * FROM v_incident WHERE severity = 1;
  ```

### 4.3 Atualização Otimista com Roteamento (Update)
Ao receber um payload com campos misturados (campos da base e campos da filha):
1. O backend consulta o dicionário de campos resolvidos da tabela e distribui as colunas entre `tbl_task` e `tbl_incident`.
2. Executa o update na tabela raiz com controle de concorrência:
   ```sql
   UPDATE tbl_task
   SET short_description = $1, sys_updated_on = clock_timestamp(), sys_updated_by = $2, sys_mod_count = sys_mod_count + 1
   WHERE sys_id = $3 AND sys_mod_count = $4;
   ```
   * Se retornar 0 linhas afetadas, lança imediatamente `ConcurrencyConflictException (HTTP 409 Conflict)`.
3. Executa o update nas colunas especializadas da tabela filha:
   ```sql
   UPDATE tbl_incident SET severity = $1 WHERE sys_id = $2;
   ```

### 4.4 Exclusão Polimórfica (Delete)
Basta excluir da tabela raiz:
```sql
DELETE FROM tbl_task WHERE sys_id = $1;
```
Graças à restrição `ON DELETE CASCADE`, o PostgreSQL remove imediatamente a tupla correspondente em `tbl_incident` e quaisquer outros descendentes.

---

## 5. Manutenção de Views Polimórficas em Alterações DDL

1. **Imutabilidade da Herança:** Após uma tabela física ser criada, o seu `super_class_id` torna-se **estritamente imutável**. Não é permitido alterar a tabela pai de uma classe existente.
2. **Propagação de Colunas:** Quando uma nova coluna é adicionada a qualquer classe ancestral, a DDL Engine busca todas as classes descendentes da árvore e regera dinamicamente `v_<nome_filha>` com os novos atributos projetados.
