# Especificação da Árvore de Condições Declarativa (`Condition_Tree`)

Este documento padroniza a sintaxe, catálogo de operadores, variáveis de contexto em tempo de execução e o algoritmo de avaliação da **Abstract Syntax Tree (AST) em JSON** utilizada para:
1. **Controle de Acesso por Registro (Row-Level Security):** `sys_permission.condition_tree`
2. **Guarda de Transições de Estado:** `sys_state_transition.condition_tree`
3. **Ativação de Regras de Negócio:** `sys_script.condition_expression`

---

## 1. Estrutura Gramatical da AST

A árvore de condições é representada por um objeto JSON recursivo composto por agrupadores lógicos (`AND` / `OR`) e nós folha (regras de comparação):

```json
{
  "operator": "AND" | "OR",
  "rules": [
    {
      "field": "nome_do_campo",
      "operator": "OPERADOR_CANONICO",
      "value": "valor_ou_variavel"
    },
    {
      "operator": "OR",
      "rules": [ ... ]
    }
  ]
}
```

### Regras de Validação Estrutural:
* O nó raiz DEVE conter a chave `operator` com valor `"AND"` ou `"OR"`.
* A chave `rules` contém uma lista homogênea contendo regras folha ou sub-árvores aninhadas.
* O atributo `field` deve existir no dicionário de atributos resolvido da tabela concreta (incluindo atributos herdados).
* Injeção SQL é terminantemente bloqueada: identificadores são validados contra `sys_dictionary` e valores são tratados via parâmetros tipados.

---

## 2. Catálogo Canônico de Operadores

### 2.1 Comparação de Valores (Numérico, String, Data)
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `EQUALS` | Igualdade estrita (`=`) | `{"field": "severity", "operator": "EQUALS", "value": 1}` |
| `NOT_EQUALS` | Desigualdade (`<>`) | `{"field": "state", "operator": "NOT_EQUALS", "value": "closed"}` |
| `GREATER_THAN` | Maior que (`>`) | `{"field": "sys_mod_count", "operator": "GREATER_THAN", "value": 0}` |
| `LESS_THAN` | Menor que (`<`) | `{"field": "severity", "operator": "LESS_THAN", "value": 3}` |
| `GREATER_THAN_OR_EQUAL` | Maior ou igual (`>=`) | `{"field": "impact", "operator": "GREATER_THAN_OR_EQUAL", "value": 2}` |
| `LESS_THAN_OR_EQUAL` | Menor ou igual (`<=`) | `{"field": "severity", "operator": "LESS_THAN_OR_EQUAL", "value": 3}` |

### 2.2 Presença e Nulidade
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `IS_EMPTY` | Nulo, string vazia `""` ou array vazio `[]` | `{"field": "close_notes", "operator": "IS_EMPTY"}` |
| `IS_NOT_EMPTY` | Possui valor válido e preenchido | `{"field": "close_notes", "operator": "IS_NOT_EMPTY"}` |

### 2.3 Correspondência Textual
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `CONTAINS` | Substring contida no texto (case-insensitive) | `{"field": "short_description", "operator": "CONTAINS", "value": "VPN"}` |
| `NOT_CONTAINS` | Substring não contida | `{"field": "short_description", "operator": "NOT_CONTAINS", "value": "TESTE"}` |
| `STARTS_WITH` | Prefixo textual | `{"field": "number", "operator": "STARTS_WITH", "value": "INC"}` |
| `ENDS_WITH` | Sufixo textual | `{"field": "email", "operator": "ENDS_WITH", "value": "@empresa.com"}` |

### 2.4 Conjunto e Listas
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `IN` | Valor do campo contido na lista fornecida | `{"field": "state", "operator": "IN", "value": ["new", "in_progress"]}` |
| `NOT_IN` | Valor do campo não contido na lista | `{"field": "state", "operator": "NOT_IN", "value": ["resolved", "closed"]}` |

### 2.5 Valores Booleanos
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `IS_TRUE` | Campo booleano é verdadeiro | `{"field": "is_active", "operator": "IS_TRUE"}` |
| `IS_FALSE` | Campo booleano é falso | `{"field": "is_active", "operator": "IS_FALSE"}` |

### 2.6 Detecção de Alteração (Exclusivo para `before_update` / `after_update`)
| Operador | Descrição | Exemplo de Aplicação |
| :--- | :--- | :--- |
| `CHANGES` | O valor mudou em relação ao banco | `{"field": "assigned_to", "operator": "CHANGES"}` |
| `CHANGES_TO` | Mudou especificamente para o valor | `{"field": "state", "operator": "CHANGES_TO", "value": "resolved"}` |
| `CHANGES_FROM` | Era anteriormente o valor especificado | `{"field": "state", "operator": "CHANGES_FROM", "value": "new"}` |

---

## 3. Variáveis Dinâmicas de Contexto

Para permitir regras dependentes do usuário conectado e do momento da execução, o campo `value` pode referenciar variáveis de contexto iniciadas por `@`:

* `@current_user.sys_id`: Substituído pelo UUID do usuário logado na sessão (`sys_user.sys_id`).
* `@current_user.groups`: Substituído pelo array de UUIDs dos grupos ativos aos quais o usuário pertence.
* `@now`: Substituído pelo carimbo de data/hora atual UTC em formato ISO 8601.

### Exemplo: Regra de Linha (RLS) - Usuário só visualiza chamados que ele abriu ou que pertencem ao seu grupo
```json
{
  "operator": "OR",
  "rules": [
    {
      "field": "caller_id",
      "operator": "EQUALS",
      "value": "@current_user.sys_id"
    },
    {
      "field": "assignment_group",
      "operator": "IN",
      "value": "@current_user.groups"
    }
  ]
}
```

---

## 4. Algoritmo de Avaliação no Backend (Golang)

O backend em Go avalia a AST de forma recursiva:

```go
func EvaluateCondition(tree ConditionTree, record map[string]interface{}, ctx SecurityContext) bool {
    if len(tree.Rules) == 0 {
        return true
    }

    if tree.Operator == "AND" {
        for _, rule := range tree.Rules {
            if !evaluateRuleOrSubtree(rule, record, ctx) {
                return false
            }
        }
        return true
    } else if tree.Operator == "OR" {
        for _, rule := range tree.Rules {
            if evaluateRuleOrSubtree(rule, record, ctx) {
                return true
            }
        }
        return false
    }
    return false
}
```

---

## 5. Tradução Opcional para Predicados SQL em Consultas `READ`

Quando aplicada em consultas polimórficas de listagem (`SELECT FROM tbl_*` ou `v_*`), a engine traduz recursivamente a AST para predicados SQL parametrizados:

```sql
-- Exemplo gerado para a condição de auto-atendimento:
WHERE (
    caller_id = $1 OR assignment_group = ANY($2::UUID[])
)
```
* Parâmetros `$1` e `$2` são preenchidos com os valores do `SecurityContext` do usuário autenticado, garantindo execução com alto desempenho e proteção absoluta contra injeção SQL.
